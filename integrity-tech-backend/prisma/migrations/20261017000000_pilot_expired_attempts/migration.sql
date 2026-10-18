-- Expired incomplete attempts keep their answers and never publish a partial score.
ALTER TABLE "exam_attempts" DROP CONSTRAINT "chk_status_enum";
ALTER TABLE "exam_attempts" ADD CONSTRAINT "chk_status_enum"
  CHECK ("status" IN ('IN_PROGRESS', 'SUBMITTED', 'GRADING', 'COMPLETED', 'ABANDONED', 'EXPIRED'));
