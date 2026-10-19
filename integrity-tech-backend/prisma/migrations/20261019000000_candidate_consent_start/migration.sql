-- Opening an invitation does not start the timed evaluation.
-- Keep every existing state valid; no existing attempts are rewritten.
ALTER TABLE "exam_attempts" DROP CONSTRAINT "chk_status_enum";
ALTER TABLE "exam_attempts" ADD CONSTRAINT "chk_status_enum"
  CHECK ("status" IN ('AWAITING_CONSENT', 'IN_PROGRESS', 'SUBMITTED', 'GRADING', 'COMPLETED', 'ABANDONED', 'EXPIRED'));
