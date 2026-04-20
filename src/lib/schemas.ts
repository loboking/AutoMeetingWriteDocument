import { z } from 'zod';

/**
 * Transcribe API response schema
 */
export const TranscribeResponseSchema = z.object({
  text: z.string().min(1, 'Transcription text is required'),
  segments: z.array(z.object({
    id: z.number(),
    start: z.number(),
    end: z.number(),
    text: z.string(),
  })).optional(),
  language: z.string().optional(),
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
