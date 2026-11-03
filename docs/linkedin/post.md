# LinkedIn: optional post

Target: 150–250 words, hook first. Copy the post from the rendered view; the `<!-- … -->`
comments are repo notes and not part of the text. This post: **245 words** (without comments,
hashtags included; a number followed by " %" counts as two words). Suggested media: a short
screen recording of the rhythm player and the Process view of the live demo.

<!-- METRICS: all model numbers of this post are in the paragraph between METRICS:START and METRICS:END (final, from web/public/data/metrics.json, generated_at 2026-11-03T12:05:00+00:00: cnn.summary and external.cnn.summary). Re-count the words after any change. -->

---

A heartbeat classifier that answers "normal" every single time would already score great accuracy on the standard ECG dataset. That's why accuracy is not my headline number.

The problem: detecting abnormal heartbeats looks solved – until you test on patients the model has never seen. If beats of the same person end up in training and test, the results are far too optimistic.

What I built: a pipeline on the MIT-BIH Arrhythmia Database that filters the raw ECG, finds the R-peaks (Pan-Tompkins), cuts out each beat and classifies it into the five AAMI classes with a compact PyTorch 1D-CNN, plus an interpretable decision tree for comparison. Training and test patients are strictly separated. A web app explains every step.

The honest result:
<!-- METRICS:START -->
macro-F1 0.59 on unseen patients. Ventricular beats work well (sensitivity 97 %, PPV 81 %), supraventricular beats are harder (sensitivity 66 %, PPV 43 %), fusion beats basically fail. On a second database, without any retraining, ventricular sensitivity stays at 90 %.
<!-- METRICS:END -->
I also looked at the test set three times in total. That is documented: the last run used a configuration frozen and committed beforehand.

How I built it: with orchestrated AI agents. An orchestrator split the project into modules, sub-agents worked in parallel on their own files, bound by written interface contracts and a lock-protected state file. A separate review wave checked the work. My part: goals, guardrails, methodology decisions and checking the results.

Live demo: https://leonrohrer.at/ekg-arrhythmia/

#MachineLearning #AIAgents #SignalProcessing #PyTorch

---

## Notes

- Add the repo link (https://github.com/LeonTheGoatRohrer/ekg-arrhythmia) only once it is public.
- Optional last line if the post should also work as an application signal: "I'm looking for an
  internship in AI and workflow automation before starting my robotics studies."
- Before posting: check every number against `web/public/data/metrics.json` (plan E3).
