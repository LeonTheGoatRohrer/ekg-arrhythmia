# EKG-Arrhythmie-Erkennung – Entwickler-Kommandos (aus dem Repo-Root ausführen)

PY       ?= .venv/bin/python
PYTEST   ?= .venv/bin/pytest
NPM      ?= npm
DATA_DIR ?= data/mitdb
RECORD   ?= data/sample/100
WEB_DATA ?= web/public/data
EPOCHS   ?= 20
PORT     ?= 8000
# e.g. PIP_EXTRA='--extra-index-url https://download.pytorch.org/whl/cpu' for the CPU-only torch wheel
PIP_EXTRA ?=

FEATURES ?= base

.PHONY: help install data demo smoke prepare train cv test web serve state all

help:
	@echo "make install | data | demo | smoke | prepare | train [EPOCHS=N] | cv [FEATURES=base|rr|patient] | test | web | serve | state | all"

install:            ## Python-venv + Paket (editable, Versionen aus constraints.txt) + Web-Abhängigkeiten
	test -x $(PY) || python3 -m venv .venv
	$(PY) -m pip install -c constraints.txt -e . pytest $(PIP_EXTRA)
	cd web && $(NPM) ci

data:               ## vollständige MIT-BIH-DB laden (braucht Zugriff auf physionet.org)
	$(PY) scripts/download_mitdb.py --data-dir $(DATA_DIR)

demo:               ## Web-Exporte aus echtem Record 100 (keine Modell-Ergebnisse)
	$(PY) -m ekg.pipeline demo --record $(RECORD) --out $(WEB_DATA) --data-dir $(DATA_DIR)

smoke:              ## Mechanik-Test (Record 100, 1 Epoche) -> nur artifacts/smoke/
	$(PY) -m ekg.pipeline smoke --record $(RECORD) --out artifacts/smoke

prepare:            ## BeatSets DS1/DS2 als npz-Cache (braucht vollständige DB)
	$(PY) -m ekg.pipeline prepare --data-dir $(DATA_DIR) --cache artifacts/beats

train:              ## CNN + Baum auf DS1, Evaluation auf DS2 -> metrics.json, tree.json, model.pt
	$(PY) -m ekg.pipeline train --data-dir $(DATA_DIR) --out artifacts --export $(WEB_DATA) --epochs $(EPOCHS)
	$(PY) -m ekg.pipeline export-state --out $(WEB_DATA)

cv:                 ## Record-gruppierte Kreuzvalidierung des CNN nur auf DS1 -> artifacts/cv/cv_<FEATURES>.json
	$(PY) -m ekg.pipeline cv --data-dir $(DATA_DIR) --features $(FEATURES)

test:              ## gesamte Python-Testsuite
	$(PYTEST) -q

web:                ## UI bauen (web/dist)
	cd web && $(NPM) run build

serve:              ## FastAPI-Server: API + gebaute UI auf http://127.0.0.1:$(PORT)
	$(PY) -m ekg.api.server --port $(PORT)

state:              ## project_state.json in die Web-Daten kopieren
	$(PY) -m ekg.pipeline export-state --out $(WEB_DATA)

report:             ## englischer PDF-Bericht aus web/public/data -> docs/report/ekg-arrhythmia-report.pdf (Extras: docs/report/requirements.txt)
	$(PY) docs/report/build_report.py

all: demo test web  ## Demo-Exporte, Tests, UI-Build
