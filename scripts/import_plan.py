#!/usr/bin/env python3
"""Turns the reference plan into src/data/plan.generated.ts.

The workbook is the source of truth for the training mechanic:
  - "Allures"           the two references and the per-block sliding zones
  - "Plan détaillé"     one row per session, 243 of them
  - "Synthèse hebdo"    the planned weekly volumes
  - "Suivi & ajustement" the adjustment rules and the RPE scale

Re-run with:  python3 scripts/import_plan.py
"""

import datetime
import pathlib
import re
import xml.etree.ElementTree as ET
import zipfile

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
ROOT = pathlib.Path(__file__).resolve().parent.parent
XLSX = ROOT / 'reference' / 'Plan30semainessemi10kmhyroxnatation.xlsx'
OUT = ROOT / 'src' / 'data' / 'plan.generated.ts'

# Excel's day 0 under the 1900 date system, offset for its leap-year bug.
EPOCH = datetime.date(1899, 12, 30)

JOURS_FR = ['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM']
JOURS_PL = ['PON', 'WT', 'ŚR', 'CZW', 'PT', 'SOB', 'ND']

# Séance label (most specific first) -> msc_type code.
TYPE_RULES = [
    ('MONTAGNE', 'montagne'),
    ("TEST 30'", 'test'),
    ('SEMI-MARATHON', 'course'),
    ('COURSE 10 KM', 'course'),
    ('Fractionné', 'allure10'),
    ("Rappel d'allure", 'allure10'),
    ('VMA', 'vma'),
    ('Seuil', 'seuil'),
    ('Sortie longue', 'longue'),
    ('Footing de récupération', 'recup'),
    ('Footing', 'ef'),
    ('Hyrox n°1', 'force'),
    ('Hyrox n°2', 'compromis'),
    ('Mobilité', 'recup'),
]
DISCIPLINE_TYPE = {
    'Repos': 'repos',
    'Natation': 'nage',
    'Vélo': 'velo',
    'Hyrox': 'force',
    'Course à pied': 'ef',
}

# Column J of the plan names zones by their label; these are the codes.
ZONE_CODES = {
    'Récup': 'recup',
    'EF': 'ef',
    'End. active': 'endactive',
    'All. marathon': 'marathon',
    'All. semi': 'semi',
    'Seuil': 'seuil',
    'All. 10 km': 'allure10',
    'All. 5 km / VMA': 'vma',
}


def load_sheets():
    with zipfile.ZipFile(XLSX) as z:
        strings = [''.join(x.itertext()) for x in ET.fromstring(z.read('xl/sharedStrings.xml'))]
        book = ET.fromstring(z.read('xl/workbook.xml'))
        rels = {r.get('Id'): r.get('Target') for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
        rid = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'
        out = {}
        for sheet in book.find('m:sheets', NS):
            target = rels[sheet.get(rid)].lstrip('/')
            if not target.startswith('xl/'):
                target = 'xl/' + target
            out[sheet.get('name')] = rows_of(ET.fromstring(z.read(target)), strings)
        return out


def rows_of(sheet, strings):
    result = []
    for row in sheet.find('m:sheetData', NS):
        cells = {}
        for c in row:
            col = ''.join(ch for ch in c.get('r') if ch.isalpha())
            v = c.find('m:v', NS)
            if v is None:
                inline = c.find('m:is', NS)
                value = ''.join(inline.itertext()) if inline is not None else ''
            elif c.get('t') == 's':
                value = strings[int(v.text)]
            else:
                value = v.text or ''
            cells[col] = value
        result.append(cells)
    return result


def clean(text):
    """The detail column carries <b> emphasis; the app renders plain text."""
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', text or '')).strip()


def num(value, default=0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def type_of(seance, discipline):
    for needle, code in TYPE_RULES:
        if needle in seance:
            return code
    return DISCIPLINE_TYPE.get(discipline, 'ef')


def zones_of(cell):
    codes = []
    for part in (cell or '').split('·'):
        code = ZONE_CODES.get(part.strip())
        if code:
            codes.append(code)
    return codes


def ts(value):
    if isinstance(value, Loc):
        return 'l(' + ts(str(value)) + ')'
    if isinstance(value, str):
        return "'" + value.replace('\\', '\\\\').replace("'", "\\'") + "'"
    if isinstance(value, bool):
        return 'true' if value else 'false'
    if isinstance(value, float):
        return repr(round(value, 4)).rstrip('0').rstrip('.') if value % 1 else str(int(value))
    if isinstance(value, int):
        return str(value)
    if isinstance(value, list):
        return '[' + ', '.join(ts(v) for v in value) + ']'
    if isinstance(value, dict):
        return '{ ' + ', '.join(f'{k}: {ts(v)}' for k, v in value.items()) + ' }'
    raise TypeError(value)


class Loc(str):
    """Plan content is French in the source; Polish falls back to it.

    Emitted as `l('…')` rather than a duplicated pair, so the fallback is
    visible in the generated file instead of looking like a translation."""


def loc(text):
    return Loc(text)


def build_sessions(rows):
    sessions = []
    for i, r in enumerate(rows[1:]):
        if not r.get('F'):
            continue
        date = EPOCH + datetime.timedelta(days=int(num(r.get('C'))))
        seance = clean(r.get('F'))
        duree = int(num(r.get('G')))
        rpe = int(num(r.get('L')))
        km = num(r.get('H'))
        metres = int(num(r.get('I')))

        meta = [f'{duree} min'] if duree else []
        if km:
            meta.append(f'{km:g} km')
        if metres:
            meta.append(f'{metres} m')
        if rpe:
            meta.append(f'RPE {rpe}')

        court = seance.split('·', 1)[1].strip() if '·' in seance else seance

        row = {
            'id': 1000 + i,
            'semaine': int(num(r.get('A'))),
            'phase': clean(r.get('B')),
            'bloc': '',  # filled in below, from the week
            'date': date.isoformat(),
            'jour': {'fr': JOURS_FR[date.weekday()], 'pl': JOURS_PL[date.weekday()]},
            'jour_long': clean(r.get('D')),
            'discipline': clean(r.get('E')),
            'type': type_of(seance, clean(r.get('E'))),
            'duree_min': duree,
            'rpe_cible': rpe,
            'charge': int(num(r.get('M'))),
            'zones': zones_of(r.get('J')),
            'titre': loc(seance),
            'titre_court': loc(court),
            'meta': loc(' · '.join(meta)) if meta else loc('repos'),
            'detail': loc(clean(r.get('N'))),
        }
        if km:
            row['distance_km'] = km
        if metres:
            row['natation_m'] = metres
        consigne = clean(r.get('K'))
        if consigne:
            row['consigne'] = loc(consigne)
        sessions.append(row)
    return sessions


def build_weeks(rows):
    weeks = []
    for r in rows[1:]:
        # The sheet carries a few trailing note rows with no phase.
        if not r.get('B') or not r.get('A', '').replace('.', '').isdigit():
            continue
        weeks.append({
            'semaine': int(num(r.get('A'))),
            'phase': clean(r.get('B')),
            'heures': round(num(r.get('C')), 3),
            'heures_course': round(num(r.get('D')), 3),
            'heures_hyrox': round(num(r.get('E')), 3),
            'heures_nage': round(num(r.get('F')), 3),
            'heures_velo': round(num(r.get('G')), 3),
            'km': round(num(r.get('H')), 2),
            'metres_nage': int(num(r.get('I'))),
            'charge': int(num(r.get('J'))),
        })
    return weeks


def main():
    sheets = load_sheets()
    sessions = build_sessions(sheets['Plan détaillé'])
    weeks = build_weeks(sheets['Synthèse hebdo'])

    # Blocks come from the Allures sheet: week span + share of the way from the
    # current reference to the target one.
    blocs = [
        {'code': 'A', 'nom': loc('Réamorçage'), 'de': 1, 'a': 6, 'part': 0.0},
        {'code': 'B', 'nom': loc('Construction semi'), 'de': 7, 'a': 13, 'part': 0.28},
        {'code': 'C', 'nom': loc('Bloc vitesse'), 'de': 14, 'a': 23, 'part': 0.65},
        {'code': 'D', 'nom': loc('Bloc final'), 'de': 24, 'a': 29, 'part': 1.0},
    ]

    def bloc_of(semaine):
        for b in blocs:
            if b['de'] <= max(semaine, 1) <= b['a']:
                return b['code']
        return 'A'

    for s in sessions:
        s['bloc'] = bloc_of(s['semaine'])
    for w in weeks:
        w['bloc'] = bloc_of(w['semaine'])

    header = f'''/* GENERATED — do not edit by hand.
   Source: reference/{XLSX.name}
   Regenerate with: python3 scripts/import_plan.py

   {len(sessions)} sessions across {len(weeks)} weeks. The plan text is French in
   the workbook, so the Polish side of each localized field falls back to it
   until the plan itself is translated. */

import type {{ Localized, MscPlanSession, MscPlanWeek }} from './types';

/** French source text, with Polish falling back to it. */
const l = (s: string): Localized => ({{ fr: s, pl: s }});

export const msc_session: MscPlanSession[] = [
'''
    body = ''.join('  ' + ts(s) + ',\n' for s in sessions)
    mid = '];\n\nexport const msc_week: MscPlanWeek[] = [\n'
    body2 = ''.join('  ' + ts(w) + ',\n' for w in weeks)
    OUT.write_text(header + body + mid + body2 + '];\n', encoding='utf-8')
    print(f'{OUT.relative_to(ROOT)} — {len(sessions)} sessions, {len(weeks)} weeks')


if __name__ == '__main__':
    main()
