# LinkedIn: "Projects" entry

Paste into Profile → Add section → Projects. Copy the description from the rendered view (e.g.
on GitHub): the `<!-- … -->` comments are notes for the repo, stay invisible there and are not
part of the text. Character counts are measured without these comments.

## Project name

Limit: 100 characters. This title: **92 characters**.

```text
ECG Arrhythmia Detection on MIT-BIH: Inter-Patient 1D-CNN, Built with Orchestrated AI Agents
```

## Description

Limit: 2,000 characters. This text: **1,905 characters** (incl. 12 line breaks; even if each
break counts as two characters, it stays below 2,000).

<!-- METRICS: all model numbers of this entry are in the paragraph between METRICS:START and METRICS:END (final, from web/public/data/metrics.json, generated_at 2026-11-03T12:05:00+00:00: cnn.summary and external.cnn.summary). Re-count the characters after any change. -->

---

I built a system that classifies single heartbeats from ECG recordings into the five AAMI EC57 classes (normal, supraventricular, ventricular, fusion, unclassifiable), using the MIT-BIH Arrhythmia Database.

The key decision was a strict inter-patient evaluation (de Chazal et al., 2004): the model is trained on one group of patients and tested on a completely different group. Mixing beats of the same person into training and test makes results look far better than they would be for a new patient.

Pipeline: baseline and band-pass filtering, Pan-Tompkins R-peak detection, beat segmentation, a compact PyTorch 1D-CNN with RR-interval features, and an interpretable decision tree for comparison. I report sensitivity and PPV per class and macro-F1, not accuracy.

<!-- METRICS:START -->
Final result on unseen patients: macro-F1 0.59 over N/S/V/F. Ventricular beats: sensitivity 97 %, PPV 81 %. Supraventricular beats: sensitivity 66 %, PPV 43 %. Fusion beats are practically not detected. On a second ECG database, applied without any retraining, ventricular sensitivity stays at 90 %, while supraventricular sensitivity drops to 46 %.
<!-- METRICS:END -->

I also document what went wrong: the test set was evaluated three times in total. After the first two looks, every model decision went through cross-validation on the training patients only, including the ideas I rejected. The final configuration was committed before the single final test run.

I built the project with orchestrated AI coding agents: an orchestrator split the work into modules, up to 16 sub-agents worked in parallel on separate files, coordinated by written interface contracts, a lock-protected shared state file and dependency-based waves, followed by an independent review wave. I set the goals and guardrails, made the methodology decisions and checked the results.

A web app explains every step from raw signal to class. Learning project, not a medical device.

---

## Skills

LinkedIn may limit the number of skills per entry; the first five are the most important.

1. Machine Learning
2. PyTorch
3. AI Agents
4. Signal Processing
5. Python

Further options: Deep Learning, Multi-Agent Systems, scikit-learn, Data Analysis, FastAPI,
JavaScript, GitHub Actions.

## Links and media

- **Live demo:** https://leonrohrer.at/ekg-arrhythmia/
- **Code:** https://github.com/LeonTheGoatRohrer/ekg-arrhythmia (add only once the repo is public)
- **Media:** screenshot `docs/screenshots/process-light-desktop.png` or a short screen recording
  of the rhythm player and the Process view.
- **Dates:** November 2026 (final evaluation on 3 November 2026).
