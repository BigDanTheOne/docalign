# Plan — Tech Lead

1. Add validator function in pipeline runtime.
2. Wire validator into `cmdAdvance` on `code_review -> verify`.
3. Create triage artifact for this run at `code_review/followups.json`.
4. Validate behavior:
   - one negative case (blocked)
   - one positive case (allowed)
5. Record verification evidence.

## Files
- `~/.openclaw/skills/pipeline/scripts/pipeline.js`
- `_team/outputs/<run_id>/code_review/followups.json`
- `_team/outputs/<run_id>/verify/tech-lead.md`
- `_team/outputs/<run_id>/build/evidence-checklist.md`
