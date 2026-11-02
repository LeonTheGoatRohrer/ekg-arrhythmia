#!/usr/bin/env python
"""Download the MIT-BIH Arrhythmia Database (48 records) from PhysioNet.

Usage: python scripts/download_mitdb.py [--data-dir data/mitdb] [--records 100 101 ...]
Exit codes: 0 = ok, 2 = data unavailable (network blocked / download failed).
"""

from __future__ import annotations

import argparse
import sys

from ekg.data.loader import MITDB_RECORDS, DataUnavailableError, download_mitdb


def parse_records(values: list[str] | None) -> list[str] | None:
    if not values:
        return None
    out: list[str] = []
    for v in values:  # accept "100 101" as well as "100,101"
        out.extend(p.strip() for p in v.split(",") if p.strip())
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="MIT-BIH Arrhythmia Database herunterladen")
    parser.add_argument("--data-dir", default="data/mitdb", help="Zielverzeichnis (Standard: data/mitdb)")
    parser.add_argument(
        "--records", nargs="*", default=None,
        help="Record-Namen (z. B. 100 101 oder 100,101); Standard: alle 48",
    )
    parser.add_argument("--base-url", default=None, help="Alternative PhysioNet-Index-URL (Mirror)")
    args = parser.parse_args(argv)

    records = parse_records(args.records)
    try:
        got = download_mitdb(args.data_dir, records=records, base_url=args.base_url)
    except DataUnavailableError as exc:
        print(
            "FEHLER: Die MIT-BIH-Daten konnten nicht geladen werden.\n"
            "physionet.org ist vermutlich durch die Netzwerk-Policy dieser Umgebung gesperrt.\n"
            "Abhilfe: physionet.org in der Netzwerk-Policy freischalten und das Skript erneut "
            f"ausführen, oder die Dateien (.hea/.dat/.atr) manuell nach '{args.data_dir}' kopieren.\n"
            f"Details: {exc}",
            file=sys.stderr,
        )
        return 2
    except ValueError as exc:
        print(f"FEHLER: {exc}. Gültige Records: {', '.join(MITDB_RECORDS)}", file=sys.stderr)
        return 1
    print(f"{len(got)} Record(s) verfügbar in '{args.data_dir}': {', '.join(got)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
