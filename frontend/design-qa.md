# PayScope Resolution Flow — design QA

## Comparison target

- Source visual truth: selected ImageGen direction 3, generated in this thread;
  local source artifact: `C:\Users\ggdri\.codex\generated_images\01a029a7-019e-78b1-95a5-75beaae7efe7\exec-ed44a7d1-dea2-4682-9597-5d745bfecdef.png`.
- Intended viewport: desktop web app, 1440 × 1024.
- Intended state: an active Test Mode incident with evidence compiled and a
  proposal ready for operator review.

## Implemented interpretation

- The dashboard is now a resolution flow: prioritised tenant incident queue →
  one selected incident → Received / Investigated / Ready for review / Recorded
  progression → chronological verified timeline → compact evidence explanation
  → one approval-gated simulated decision.
- Required technical detail remains available behind `See the full
  investigation`, `Audit trail`, and `Operational insights`; it no longer
  competes with the primary operator task.
- All live data, API reads, runtime guards, tenant scope, audit gate, approval
  token handling, and simulated-only communication behavior remain unchanged.

## Browser evidence

- Local Vite preview was started with `host: 0.0.0.0`, port `4173`, and
  `terminal.local` allowed.
- The configured in-app browser could not resolve
  `http://terminal.local:4173/` (`ERR_NAME_NOT_RESOLVED`). Consequently it
  could not capture the implementation, test the queue/disclosures/approval
  interaction, inspect console output, or provide a same-viewport comparison.
- A production TypeScript/Vite build passes, but a build is not visual QA.

## Required fidelity surfaces

- Fonts and typography: blocked pending a browser capture.
- Spacing and layout rhythm: blocked pending a browser capture.
- Colors and visual tokens: blocked pending a browser capture.
- Image and icon fidelity: the selected reference uses standard UI icons only;
  the existing `lucide-react` icon system is used. Visual comparison is still
  blocked.
- Copy and app content: reviewed in source for the locked Test Mode,
  proposal-only, and no-customer-message boundary; visual review is blocked.

## Implementation checklist

1. Deploy this frontend build or provide a browser-accessible preview.
2. Capture the selected-incident desktop state at 1440 × 1024 and the 390px
   queue/detail state.
3. Compare those captures directly with the selected source image, fix any
   P0–P2 differences, and then update this record with the iteration history.
4. Test queue selection, filter reset, disclosures, read-only question, and
   token-gated simulated approval with current Test Mode data.

## Final result: blocked
