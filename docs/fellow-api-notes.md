# Fellow Developer API — integration notes

Spike for issue [#24](https://github.com/andreagrandi/obsidian-meeting-notes-sync/issues/24).
Workspace exercised: `example` (placeholder). API version observed: `1.0.2`.

## Endpoints exercised

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/me` | Health / auth validation |
| `POST` | `/api/v1/notes` | List notes with filters and optional includes |
| `GET` | `/api/v1/note/{note_id}` | Note detail |
| `POST` | `/api/v1/recordings` | List recordings with filters and optional includes |
| `GET` | `/api/v1/recording/{recording_id}` | Recording detail |

All calls use `X-API-KEY` header against `https://{subdomain}.fellow.app/api/v1/`.

Note: PLAN.md §12.2 and the issue describe the detail paths as plural (`/notes/{id}`, `/recordings/{id}`). The live API uses the singular paths shown above.

## Findings

### 1. AI recap placement

The full AI recap lives on the **Recording** object, not in `Note.content_markdown`.

* `Note.content_markdown` contains the user's manual note sections (`Talking Points`, `Action Items`, `Notepad`) plus a small "AI-Detected Action Items" appendix when Fellow extracts action items.
* `Recording.ai_notes` is an array of structured recaps. Each recap has `sections` such as `Summary`, `Action items`, `Decisions`, `Topics`, and potentially `Key Moments` (observed schema variant). The `Summary` section content is plain markdown text; `Topics` is an array of topics with bullet points; `Action items` and `Decisions` are arrays of objects (or empty arrays); `Key Moments` would be an array of `{timestamp, text}` objects.
* `Recording.transcript` contains `speech_segments` with `start`, `end`, `speaker`, `text` and a `language_code`.

**Decision:** the Fellow adapter should treat the **Recording** as the primary enumeration object. AI recaps and transcripts come from `POST /recordings` with `include: {ai_notes: true, transcript: true}`. The associated Note is fetched via `recording.note_id` only when the user has enabled manual meeting notes.

### 2. Change-detection field

Both `Note.updated_at` and `Recording.updated_at` exist. On a live recorded meeting observed during this spike:

* Meeting ended at `2026-06-11T13:44:36.481Z`.
* `Note.updated_at` was `2026-06-11T13:43:11.735Z` (before the meeting ended).
* `Recording.updated_at` was `2026-06-11T13:46:05.809Z` (after AI processing completed).

**Decision:** use `Recording.updated_at` as the change-detection timestamp for Fellow sync. Poll recordings with `filters.updated_at_start` set to the last-sync watermark. This reliably catches late-generated AI recaps.

### 3. `include` mechanism

`include` is an object in the **POST request body**, not a query-string parameter. Expensive fields are omitted by default.

* `GetNotesRequest.include`: `{ content_markdown?: boolean; event_attendees?: boolean }`
* `GetRecordingsRequest.include`: `{ transcript?: boolean; ai_notes?: boolean }`

The detail GET endpoints (`GET /note/{id}`, `GET /recording/{id}`) return the expensive fields by default in the live API, even without query parameters. However, the client should rely on `POST /recordings` with body includes for the list pass because that gives change detection, pagination, and expensive fields in a single call.

### 4. Pagination

All list endpoints use cursor-based pagination.

* Request body shape: `{ pagination: { cursor: string | null, page_size: 1..50 }, filters?: {...}, include?: {...} }`
* Default `page_size` is 20; max is 50.
* First request uses `cursor: null` (or omits the key).
* Subsequent requests use the `cursor` from `response.data.page_info.cursor`.
* End of results is indicated by `cursor: null` in `page_info`.

### 5. Filters

Both `NoteFilters` and `RecordingFilters` support:

* `event_guid` — useful for cross-source identity matching (tie a Fellow recording to a calendar event).
* `created_at_start`, `created_at_end` — ISO 8601 timestamps.
* `updated_at_start`, `updated_at_end` — ISO 8601 timestamps; `updated_at_start` is the main incremental-sync filter.
* `channel_id` — workspace channel filter.
* `title` — substring match on title.

Note also supports `event_attendees` (array of emails).

### 6. Enumeration strategy

**Primary enumeration object: Recording, via `POST /recordings` with `include: {ai_notes: true, transcript: true}`.**

Rationale:

* Recordings carry the AI recap (`ai_notes`) and transcript.
* `Recording.updated_at` is the reliable change timestamp for late-generated AI content.
* `filters.updated_at_start` drives efficient incremental sync.
* `event_guid` on the recording can be used for cross-source matching.

For manual notes, fetch `GET /note/{recording.note_id}` when the note sync toggle is enabled. Notes without recordings exist but contain no AI content and no transcript; they can be ignored unless the user explicitly wants manual-only notes.

### 7. `media_url`

`Recording.media_url` is a pre-signed URL for the recording media. It requires a privileged API key and is `null` for personal keys. Not used by this plugin.

## Redacted JSON samples

### `GET /me`

```json
{
  "user": {
    "id": "user_abc123",
    "email": "user@example.com",
    "full_name": "Example User"
  },
  "workspace": {
    "id": "workspace_xyz789",
    "name": "Example Workspace",
    "subdomain": "example"
  }
}
```

### `POST /notes` — list response

Request body:

```json
{
  "pagination": { "cursor": null, "page_size": 5 },
  "filters": { "updated_at_start": "2026-06-01T00:00:00Z" },
  "include": { "content_markdown": true, "event_attendees": true }
}
```

Response:

```json
{
  "notes": {
    "page_info": {
      "cursor": "eyJpZCI6IDEyMzQ1Nn0=",
      "page_size": 5
    },
    "data": [
      {
        "id": "note_001",
        "created_at": "2026-06-11T12:41:12.184Z",
        "updated_at": "2026-06-11T13:43:11.735Z",
        "title": "Example Team Meeting",
        "event_guid": "guid_001_20260611T130000Z",
        "event_start": "2026-06-11T13:00:00Z",
        "event_end": "2026-06-11T13:50:00Z",
        "event_is_all_day": false,
        "recording_ids": ["recording_001"],
        "event_attendees": [
          { "email": "one@example.com" },
          { "email": "two@example.com" }
        ],
        "content_markdown": "# Talking Points\n(Placeholder talking points)\n\n# Action Items\n(Placeholder action items)\n\n# Notepad\n(Placeholder notepad content)"
      }
    ]
  }
}
```

### `GET /note/{note_id}`

```json
{
  "note": {
    "id": "note_001",
    "created_at": "2026-06-11T12:41:12.184Z",
    "updated_at": "2026-06-11T13:43:11.735Z",
    "title": "Example Team Meeting",
    "event_guid": "guid_001_20260611T130000Z",
    "event_start": "2026-06-11T13:00:00Z",
    "event_end": "2026-06-11T13:50:00Z",
    "event_is_all_day": false,
    "recording_ids": ["recording_001"],
    "event_attendees": [
      { "email": "one@example.com" },
      { "email": "two@example.com" }
    ],
    "content_markdown": "# Talking Points\n(Placeholder talking points)\n\n# Action Items\n(Placeholder action items)\n\n# Notepad\n(Placeholder notepad content)\n\n# AI-Detected Action Items\n* Action Item: Placeholder action item text (Assigned to: Example User)"
  }
}
```

### `POST /recordings` — list response

Request body:

```json
{
  "pagination": { "cursor": null, "page_size": 5 },
  "filters": { "updated_at_start": "2026-06-01T00:00:00Z" },
  "include": { "ai_notes": true, "transcript": true }
}
```

Response:

```json
{
  "recordings": {
    "page_info": {
      "cursor": "eyJpZCI6IDk4NzY1NH0=",
      "page_size": 5
    },
    "data": [
      {
        "id": "recording_001",
        "title": "Example Team Meeting",
        "created_at": "2026-06-11T12:41:12.874Z",
        "updated_at": "2026-06-11T13:46:05.809Z",
        "started_at": "2026-06-11T13:03:09.585Z",
        "ended_at": "2026-06-11T13:44:36.481Z",
        "event_call_url": "https://meet.example.com/abc-def-ghi",
        "event_guid": "guid_001_20260611T130000Z",
        "note_id": "note_001",
        "user_has_calendar_event": true,
        "transcript": {
          "speech_segments": [
            {
              "start": 2.56,
              "end": 6.64,
              "speaker": "Example Speaker",
              "text": "Redacted transcript sentence."
            }
          ],
          "language_code": "en"
        },
        "ai_notes": [
          {
            "id": "GENERAL",
            "is_active": true,
            "title": "GENERAL",
            "template_creator": "Fellow",
            "sections": [
              {
                "title": "Summary",
                "type": "STANDARD",
                "content": "Redacted AI-generated summary of the meeting."
              },
              {
                "title": "Action items",
                "type": "STANDARD",
                "content": [
                  {
                    "timestamp": 1234,
                    "text": "Redacted action item text",
                    "id": "action_001",
                    "assignees": [
                      {
                        "id": "user_abc123",
                        "full_name": "Example User",
                        "email": "user@example.com"
                      }
                    ],
                    "completion_type": "all",
                    "due_date": null,
                    "accepted": false,
                    "status": "Incomplete"
                  }
                ]
              },
              {
                "title": "Decisions",
                "type": "STANDARD",
                "content": [
                  {
                    "timestamp": 1234,
                    "text": "Redacted decision text."
                  }
                ]
              },
              {
                "title": "Topics",
                "type": "STANDARD",
                "content": [
                  {
                    "title": "Example topic",
                    "bullet_points": [
                      {
                        "timestamp": 123,
                        "text": "Redacted topic bullet point."
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ],
        "media_url": null
      }
    ]
  }
}
```

### `GET /recording/{recording_id}`

The detail endpoint returns transcript and `ai_notes` by default in the live API.

```json
{
  "recording": {
    "id": "recording_001",
    "title": "Example Team Meeting",
    "created_at": "2026-06-11T12:41:12.874Z",
    "updated_at": "2026-06-11T13:46:05.809Z",
    "started_at": "2026-06-11T13:03:09.585Z",
    "ended_at": "2026-06-11T13:44:36.481Z",
    "event_call_url": "https://meet.example.com/abc-def-ghi",
    "event_guid": "guid_001_20260611T130000Z",
    "note_id": "note_001",
    "user_has_calendar_event": true,
    "transcript": {
      "speech_segments": [
        {
          "start": 2.56,
          "end": 6.64,
          "speaker": "Example Speaker",
          "text": "Redacted transcript sentence."
        }
      ],
      "language_code": "en"
    },
    "ai_notes": [
      {
        "id": "GENERAL",
        "is_active": true,
        "title": "GENERAL",
        "template_creator": "Fellow",
        "sections": [
          {
            "title": "Summary",
            "type": "STANDARD",
            "content": "Redacted AI-generated summary of the meeting."
          }
        ]
      }
    ],
    "media_url": null
  }
}
```

## Type notes for `src/fellow/types.ts`

A reader should be able to write these types from this doc alone:

### Shared

* `FellowPaginatedRequestParams`: `{ cursor?: string | null; page_size?: number }`
* `FellowPageInfo`: `{ cursor: string | null; page_size: number }`
* `FellowPaginatedResponse<T>`: `{ page_info: FellowPageInfo; data: T[] }`
* `FellowUser`: `{ id: string; email: string; full_name: string }`
* `FellowWorkspace`: `{ id: string; name: string; subdomain: string }`
* `FellowMeResponse`: `{ user: FellowUser; workspace: FellowWorkspace }`
* `FellowAttendee`: `{ email: string | null }`

### Notes

* `NoteFilters`: `{ event_guid?: string | null; created_at_start?: string | null; created_at_end?: string | null; updated_at_start?: string | null; updated_at_end?: string | null; channel_id?: string | null; title?: string | null; event_attendees?: string[] | null }`
* `NoteIncludableExpensiveField`: `{ content_markdown?: boolean; event_attendees?: boolean }`
* `GetNotesRequest`: `{ pagination?: FellowPaginatedRequestParams; filters?: NoteFilters; include?: NoteIncludableExpensiveField }`
* `FellowNote`: `{ id: string; created_at: string | null; updated_at: string | null; title: string | null; event_guid: string | null; event_start: string | null; event_end: string | null; event_is_all_day: boolean; recording_ids: string[]; event_attendees: FellowAttendee[] | null; content_markdown: string | null }`
* `FellowNotesListResponse`: `{ notes: FellowPaginatedResponse<FellowNote> }`
* `FellowNoteResponse`: `{ note: FellowNote }`

### Recordings

* `RecordingFilters`: `{ event_guid?: string | null; created_at_start?: string | null; created_at_end?: string | null; updated_at_start?: string | null; updated_at_end?: string | null; channel_id?: string | null; title?: string | null }`
* `RecordingIncludableExpensiveField`: `{ transcript?: boolean; ai_notes?: boolean }`
* `GetRecordingsRequest`: `{ pagination?: FellowPaginatedRequestParams; filters?: RecordingFilters; include?: RecordingIncludableExpensiveField; media_url?: { expire_in?: number } }`
* `FellowTranscriptSegment`: `{ start: number; end: number; speaker: string | null; text: string }`
* `FellowTranscript`: `{ speech_segments: FellowTranscriptSegment[]; language_code: string | null }`
* `FellowRecapActionItem`: `{ timestamp: number; text: string; id: string | null; assignees: FellowUser[]; completion_type: "all" | "any" | null; due_date: string | null; accepted: boolean; status: "Done" | "Archived" | "Incomplete" }`
* `FellowRecapBulletPoint`: `{ timestamp: number; text: string }`
* `FellowRecapTopic`: `{ title: string; bullet_points: FellowRecapBulletPoint[] }`
* `FellowRecapDecision`: `{ timestamp: number; text: string }`
* `FellowRecapKeyMoment`: `{ timestamp: number; text: string }`
* `FellowRecapSection`: `{ title: string; type: "STANDARD" | "CUSTOM"; content: FellowRecapActionItem[] | FellowRecapDecision[] | FellowRecapTopic[] | FellowRecapKeyMoment[] | string }`
* `FellowRecap`: `{ id: string; is_active: boolean; title: string; template_creator: string; sections: FellowRecapSection[] }`
* `FellowRecording`: `{ id: string; title: string | null; created_at: string | null; updated_at: string | null; started_at: string; ended_at: string | null; event_call_url: string | null; event_guid: string | null; note_id: string | null; user_has_calendar_event: boolean | null; transcript: FellowTranscript | null; ai_notes: FellowRecap[] | null; media_url: string | null }`
* `FellowRecordingsListResponse`: `{ recordings: FellowPaginatedResponse<FellowRecording> }`
* `FellowRecordingResponse`: `{ recording: FellowRecording }`
