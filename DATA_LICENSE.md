# Daten-Lizenz / Data License

*Deutsch · [English](#english)*

Der Code in diesem Repository steht unter der MIT-Lizenz (siehe [`LICENSE`](LICENSE)).
Die EKG-Daten gehören **nicht** dazu.

## MIT-BIH Arrhythmia Database

`data/sample/100.dat`, `data/sample/100.atr` und `data/sample/100.hea` sind Record 100 der
**MIT-BIH Arrhythmia Database** (Version 1.0.0, PhysioNet). Die Datenbank steht unter der
[Open Data Commons Attribution License v1.0 (ODC-By 1.0)](https://opendatacommons.org/licenses/by/1-0/)
([Lizenztext auf PhysioNet](https://physionet.org/content/mitdb/view-license/1.0.0/)).

- `100.dat` und `100.atr` sind byte-identisch mit den Dateien auf PhysioNet.
- `100.hea` hat denselben Inhalt, enthält aber zusätzlich eine Kommentarzeile und eine Leerzeile
  und verwendet LF- statt CRLF-Zeilenenden.

Die Web-Exporte unter `web/public/data/` und die Screenshots unter `docs/screenshots/` enthalten
Signalausschnitte und Kennzahlen, die aus dieser Datenbank abgeleitet sind; dafür gilt dieselbe
Quellenangabe. Die vollständige Datenbank liegt nicht im Repository; `make data` lädt sie von
PhysioNet.

Quelle: <https://physionet.org/content/mitdb/1.0.0/>

### Quellenangabe

Datensatz:

> Moody, G., & Mark, R. (2005). MIT-BIH Arrhythmia Database (version 1.0.0). *PhysioNet*.
> RRID:SCR_007345. <https://doi.org/10.13026/C2F305>

Originalpublikation:

> Moody GB, Mark RG. The impact of the MIT-BIH Arrhythmia Database. *IEEE Engineering in
> Medicine and Biology Magazine*. 2001;20(3):45–50. (PMID: 11446209)
> <https://doi.org/10.1109/51.932724>

PhysioNet (aktuelle Standardzitation laut PhysioNet):

> Pollard, T., Moody, B. E., Lehman, L., Gow, B., Fernandes, C., Xie, C., Johnson, A.,
> Mark, R. G., & Heldt, T. (2026). PhysioNet as a global platform for biomedical research.
> *Nature Health*. <https://doi.org/10.1038/s44360-026-00096-z>

PhysioNet (frühere Standardzitation):

> Goldberger AL, Amaral LAN, Glass L, Hausdorff JM, Ivanov PCh, Mark RG, Mietus JE, Moody GB,
> Peng C-K, Stanley HE. PhysioBank, PhysioToolkit, and PhysioNet: Components of a New Research
> Resource for Complex Physiologic Signals. *Circulation*. 2000;101(23):e215–e220.
> <https://doi.org/10.1161/01.CIR.101.23.e215>

---

<a id="english"></a>

## English

The code in this repository is licensed under the MIT License (see [`LICENSE`](LICENSE)).
The ECG data is **not** covered by it.

`data/sample/100.dat`, `data/sample/100.atr` and `data/sample/100.hea` are record 100 of the
**MIT-BIH Arrhythmia Database** (version 1.0.0, PhysioNet), licensed under the
[Open Data Commons Attribution License v1.0 (ODC-By 1.0)](https://opendatacommons.org/licenses/by/1-0/)
([license text on PhysioNet](https://physionet.org/content/mitdb/view-license/1.0.0/)).

- `100.dat` and `100.atr` are byte-identical to the files on PhysioNet.
- `100.hea` has the same content but contains an additional comment line and an empty line,
  and uses LF instead of CRLF line endings.

The web exports in `web/public/data/` and the screenshots in `docs/screenshots/` contain signal
excerpts and figures derived from this database; the same attribution applies. The full
database is not part of the repository; `make data` downloads it from PhysioNet.

Source: <https://physionet.org/content/mitdb/1.0.0/>

Please cite the four references listed above under
[Quellenangabe](#quellenangabe): the dataset, the original publication, and the PhysioNet
standard citation (current and former).
