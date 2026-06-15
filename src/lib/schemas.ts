import { z } from 'zod';

/**
 * Transcribe API response schema
 */
// 화자분리 segment 스키마 (speaker 필수, start < end)
export const DiarizationSegmentSchema = z
  .object({
    speaker: z.string().min(1, 'speaker is required'),
    text: z.string().min(1, 'text is required'),
    start: z.number().nonnegative(),
    end: z.number().nonnegative(),
    confidence: z.number().min(0).max(1).optional(),
    isEstimated: z.boolean().optional(),
  })
  .refine((s) => s.start <= s.end, { message: 'start must be <= end' });

export type DiarizationSegment = z.infer<typeof DiarizationSegmentSchema>;

export const TranscribeResponseSchema = z.object({
  text: z.string().min(1, 'Transcription text is required'),
  // 화자분리 segments (신규). 기존 {id,start,end,text}는 deprecate.
  segments: z.array(DiarizationSegmentSchema).optional(),
  duration: z.number().optional(),
  language: z.string().optional(),
  provider: z.string().optional(),
  hasSpeakerDiarization: z.boolean().optional(),
});

export type TranscribeResponse = z.infer<typeof TranscribeResponseSchema>;

/**
 * Meeting summary schema
 */
export const MeetingSummarySchema = z.object({
  title: z.string().min(1, 'Title is required'),
  summary: z.string().min(1, 'Summary is required'),
  keyPoints: z.array(z.string()).optional(),
  actionItems: z.array(z.object({
    task: z.string(),
    assignee: z.string().optional(),
    deadline: z.string().optional(),
  })).optional(),
  participants: z.array(z.string()).optional(),
  date: z.string().optional(),
});

export type MeetingSummary = z.infer<typeof MeetingSummarySchema>;

/**
 * Validate transcribe response
 */
export function validateTranscribeResponse(data: unknown): TranscribeResponse {
  return TranscribeResponseSchema.parse(data);
}

/**
 * Validate meeting summary
 */
export function validateMeetingSummary(data: unknown): MeetingSummary {
  return MeetingSummarySchema.parse(data);
}

/**
 * Safe parse with error handling
 */
export function safeParseTranscribeResponse(data: unknown) {
  return TranscribeResponseSchema.safeParse(data);
}

export function safeParseMeetingSummary(data: unknown) {
  return MeetingSummarySchema.safeParse(data);
}
