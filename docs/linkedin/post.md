# LinkedIn: optional post

Target: 150–250 words, hook first. Copy the post from the rendered view; the `<!-- … -->`
comments are repo notes and not part of the text. This post: **231 words** (without comments,
hashtags included; a number followed by " %" counts as two words). Suggested media: a short screen recording of the rhythm player and the
Process view of the live demo.

<!-- METRICS: all model numbers of this post are in the paragraph between METRICS:START and METRICS:END (preliminary, from web/public/data/metrics.json, 2026-11-02). Replace it after the final DS2 evaluation and re-count the words. -->

---

A heartbeat classifier that answers "normal" every single time would already score great accuracy on the standard ECG dataset. That's why accuracy is not my headline number.

The problem: detecting abnormal heartbeats looks solved – until you test on patients the model has never seen. If beats of the same person end up in training and test, the results are far too optimistic.

What I built: a pipeline on the MIT-BIH Arrhythmia Database that filters the raw ECG, finds the R-peaks (Pan-Tompkins), cuts out each beat and classifies it into the five AAMI classes with a compact PyTorch 1D-CNN, plus an interpretable decision tree for comparison. Training and test patients are strictly separated. A web app explains every step.

The honest result, still preliminary:
<!-- METRICS:START -->
macro-F1 0.58 on unseen patients. Ventricular beats work reasonably well (sensitivity 79 %, PPV 94 %), supraventricular beats are harder (PPV 40 %), fusion beats basically fail.
<!-- METRICS:END -->
I also evaluated the test set twice so far. That is documented, and from now on it stays locked until one final run.

How I built it: with orchestrated AI agents. An orchestrator split the project into modules, sub-agents worked in parallel on their own files, bound by written interface contracts and a lock-protected state file. A separate review wave checked the work. My part: goals, guardrails, methodology decisions and checking the results.

Live demo: https://leonrohrer.at/ekg-arrhythmia/

#MachineLearning #AIAgents #SignalProcessing #PyTorch

---

## Notes

- Add the repo link (https://github.com/LeonTheGoatRohrer/ekg-arrhythmia) only once it is public.
- Optional last line if the post should also work as an application signal: "I'm looking for an
  internship in AI and workflow automation before starting my robotics studies."
- Before posting: check every number against `web/public/data/metrics.json` (plan E3).
