"""Country / region lookup for posting locations (15 §10.1): ISO 3166 names and aliases,
US states and Indonesian provinces. No geocoding service is used.
"""

from __future__ import annotations

import re
import unicodedata
from functools import cache
from typing import Final

# ISO 3166-1 alpha-2 | English short name | aliases (lowercase matching is used)
_COUNTRIES: Final = """
AD|Andorra
AE|United Arab Emirates|UAE|U.A.E.|Emirates
AF|Afghanistan
AG|Antigua and Barbuda
AI|Anguilla
AL|Albania
AM|Armenia
AO|Angola
AQ|Antarctica
AR|Argentina
AS|American Samoa
AT|Austria|Österreich
AU|Australia
AW|Aruba
AX|Åland Islands|Aland Islands
AZ|Azerbaijan
BA|Bosnia and Herzegovina|Bosnia
BB|Barbados
BD|Bangladesh
BE|Belgium|Belgique|België
BF|Burkina Faso
BG|Bulgaria
BH|Bahrain
BI|Burundi
BJ|Benin
BL|Saint Barthélemy
BM|Bermuda
BN|Brunei Darussalam|Brunei
BO|Bolivia
BQ|Bonaire, Sint Eustatius and Saba|Caribbean Netherlands
BR|Brazil|Brasil
BS|Bahamas|The Bahamas
BT|Bhutan
BV|Bouvet Island
BW|Botswana
BY|Belarus
BZ|Belize
CA|Canada
CC|Cocos (Keeling) Islands
CD|Democratic Republic of the Congo|DR Congo|DRC|Congo-Kinshasa
CF|Central African Republic
CG|Republic of the Congo|Congo|Congo-Brazzaville
CH|Switzerland|Schweiz|Suisse
CI|Côte d'Ivoire|Cote d'Ivoire|Ivory Coast
CK|Cook Islands
CL|Chile
CM|Cameroon
CN|China|PRC|People's Republic of China|Mainland China|Tiongkok
CO|Colombia
CR|Costa Rica
CU|Cuba
CV|Cabo Verde|Cape Verde
CW|Curaçao|Curacao
CX|Christmas Island
CY|Cyprus
CZ|Czechia|Czech Republic
DE|Germany|Deutschland|Jerman
DJ|Djibouti
DK|Denmark|Danmark
DM|Dominica
DO|Dominican Republic
DZ|Algeria
EC|Ecuador
EE|Estonia
EG|Egypt|Mesir
EH|Western Sahara
ER|Eritrea
ES|Spain|España|Spanyol
ET|Ethiopia
FI|Finland|Suomi
FJ|Fiji
FK|Falkland Islands
FM|Micronesia
FO|Faroe Islands
FR|France|Prancis
GA|Gabon
GB|United Kingdom|UK|U.K.|Great Britain|Britain|England|Scotland|Wales|Northern Ireland|Inggris
GD|Grenada
GE|Georgia (country)|Sakartvelo
GF|French Guiana
GG|Guernsey
GH|Ghana
GI|Gibraltar
GL|Greenland
GM|Gambia|The Gambia
GN|Guinea
GP|Guadeloupe
GQ|Equatorial Guinea
GR|Greece|Hellas
GS|South Georgia and the South Sandwich Islands
GT|Guatemala
GU|Guam
GW|Guinea-Bissau
GY|Guyana
HK|Hong Kong|Hong Kong SAR
HM|Heard Island and McDonald Islands
HN|Honduras
HR|Croatia|Hrvatska
HT|Haiti
HU|Hungary|Magyarország
ID|Indonesia|Republik Indonesia|RI
IE|Ireland|Republic of Ireland|Éire
IL|Israel
IM|Isle of Man
IN|India
IO|British Indian Ocean Territory
IQ|Iraq
IR|Iran
IS|Iceland
IT|Italy|Italia
JE|Jersey
JM|Jamaica
JO|Jordan
JP|Japan|Nippon|Jepang
KE|Kenya
KG|Kyrgyzstan
KH|Cambodia|Kamboja
KI|Kiribati
KM|Comoros
KN|Saint Kitts and Nevis
KP|North Korea|DPRK
KR|South Korea|Korea|Republic of Korea|Korea Selatan
KW|Kuwait
KY|Cayman Islands
KZ|Kazakhstan
LA|Laos|Lao PDR
LB|Lebanon
LC|Saint Lucia
LI|Liechtenstein
LK|Sri Lanka
LR|Liberia
LS|Lesotho
LT|Lithuania
LU|Luxembourg
LV|Latvia
LY|Libya
MA|Morocco
MC|Monaco
MD|Moldova
ME|Montenegro
MF|Saint Martin
MG|Madagascar
MH|Marshall Islands
MK|North Macedonia|Macedonia
ML|Mali
MM|Myanmar|Burma
MN|Mongolia
MO|Macao|Macau
MP|Northern Mariana Islands
MQ|Martinique
MR|Mauritania
MS|Montserrat
MT|Malta
MU|Mauritius
MV|Maldives
MW|Malawi
MX|Mexico|México|Meksiko
MY|Malaysia
MZ|Mozambique
NA|Namibia
NC|New Caledonia
NE|Niger
NF|Norfolk Island
NG|Nigeria
NI|Nicaragua
NL|Netherlands|The Netherlands|Holland|Nederland|Belanda
NO|Norway|Norge
NP|Nepal
NR|Nauru
NU|Niue
NZ|New Zealand|Aotearoa|Selandia Baru
OM|Oman
PA|Panama
PE|Peru
PF|French Polynesia
PG|Papua New Guinea
PH|Philippines|Filipina
PK|Pakistan
PL|Poland|Polska
PM|Saint Pierre and Miquelon
PN|Pitcairn
PR|Puerto Rico
PS|Palestine|State of Palestine
PT|Portugal
PW|Palau
PY|Paraguay
QA|Qatar
RE|Réunion|Reunion
RO|Romania
RS|Serbia
RU|Russia|Russian Federation|Rusia
RW|Rwanda
SA|Saudi Arabia|KSA|Arab Saudi
SB|Solomon Islands
SC|Seychelles
SD|Sudan
SE|Sweden|Sverige
SG|Singapore|Singapura
SH|Saint Helena
SI|Slovenia
SJ|Svalbard and Jan Mayen
SK|Slovakia
SL|Sierra Leone
SM|San Marino
SN|Senegal
SO|Somalia
SR|Suriname
SS|South Sudan
ST|Sao Tome and Principe
SV|El Salvador
SX|Sint Maarten
SY|Syria
SZ|Eswatini|Swaziland
TC|Turks and Caicos Islands
TD|Chad
TF|French Southern Territories
TG|Togo
TH|Thailand|Thai
TJ|Tajikistan
TK|Tokelau
TL|Timor-Leste|East Timor|Timor Leste
TM|Turkmenistan
TN|Tunisia
TO|Tonga
TR|Türkiye|Turkey|Turki
TT|Trinidad and Tobago
TV|Tuvalu
TW|Taiwan
TZ|Tanzania
UA|Ukraine
UG|Uganda
UM|United States Minor Outlying Islands
US|United States|USA|U.S.A.|U.S.|US|United States of America|America|Amerika Serikat
UY|Uruguay
UZ|Uzbekistan
VA|Holy See|Vatican City|Vatican
VC|Saint Vincent and the Grenadines
VE|Venezuela
VG|British Virgin Islands
VI|U.S. Virgin Islands|US Virgin Islands
VN|Viet Nam|Vietnam
VU|Vanuatu
WF|Wallis and Futuna
WS|Samoa
YE|Yemen
YT|Mayotte
ZA|South Africa|Afrika Selatan
ZM|Zambia
ZW|Zimbabwe
"""

US_STATES: Final[dict[str, str]] = {
    "AL": "Alabama",
    "AK": "Alaska",
    "AZ": "Arizona",
    "AR": "Arkansas",
    "CA": "California",
    "CO": "Colorado",
    "CT": "Connecticut",
    "DE": "Delaware",
    "DC": "District of Columbia",
    "FL": "Florida",
    "GA": "Georgia",
    "HI": "Hawaii",
    "ID": "Idaho",
    "IL": "Illinois",
    "IN": "Indiana",
    "IA": "Iowa",
    "KS": "Kansas",
    "KY": "Kentucky",
    "LA": "Louisiana",
    "ME": "Maine",
    "MD": "Maryland",
    "MA": "Massachusetts",
    "MI": "Michigan",
    "MN": "Minnesota",
    "MS": "Mississippi",
    "MO": "Missouri",
    "MT": "Montana",
    "NE": "Nebraska",
    "NV": "Nevada",
    "NH": "New Hampshire",
    "NJ": "New Jersey",
    "NM": "New Mexico",
    "NY": "New York",
    "NC": "North Carolina",
    "ND": "North Dakota",
    "OH": "Ohio",
    "OK": "Oklahoma",
    "OR": "Oregon",
    "PA": "Pennsylvania",
    "RI": "Rhode Island",
    "SC": "South Carolina",
    "SD": "South Dakota",
    "TN": "Tennessee",
    "TX": "Texas",
    "UT": "Utah",
    "VT": "Vermont",
    "VA": "Virginia",
    "WA": "Washington",
    "WV": "West Virginia",
    "WI": "Wisconsin",
    "WY": "Wyoming",
}

#: Indonesian provinces (regions of ID); "DKI Jakarta" and "Jakarta" both resolve.
ID_PROVINCES: Final = (
    "Aceh",
    "Sumatera Utara|North Sumatra",
    "Sumatera Barat|West Sumatra",
    "Riau",
    "Kepulauan Riau|Riau Islands",
    "Jambi",
    "Bengkulu",
    "Sumatera Selatan|South Sumatra",
    "Kepulauan Bangka Belitung|Bangka Belitung",
    "Lampung",
    "Banten",
    "DKI Jakarta|Jakarta Raya",
    "Jawa Barat|West Java",
    "Jawa Tengah|Central Java",
    "DI Yogyakarta|Daerah Istimewa Yogyakarta|Special Region of Yogyakarta",
    "Jawa Timur|East Java",
    "Bali",
    "Nusa Tenggara Barat|West Nusa Tenggara|NTB",
    "Nusa Tenggara Timur|East Nusa Tenggara|NTT",
    "Kalimantan Barat|West Kalimantan",
    "Kalimantan Tengah|Central Kalimantan",
    "Kalimantan Selatan|South Kalimantan",
    "Kalimantan Timur|East Kalimantan",
    "Kalimantan Utara|North Kalimantan",
    "Sulawesi Utara|North Sulawesi",
    "Gorontalo",
    "Sulawesi Tengah|Central Sulawesi",
    "Sulawesi Barat|West Sulawesi",
    "Sulawesi Selatan|South Sulawesi",
    "Sulawesi Tenggara|Southeast Sulawesi",
    "Maluku",
    "Maluku Utara|North Maluku",
    "Papua",
    "Papua Barat|West Papua",
    "Papua Selatan|South Papua",
    "Papua Tengah|Central Papua",
    "Papua Pegunungan|Highland Papua",
    "Papua Barat Daya|Southwest Papua",
)

#: Words that mean "anywhere" (workplace_type = remote, no city).
REMOTE_WORDS: Final = re.compile(
    r"\b(remote|anywhere|wfh|work from home|work-from-home|fully remote|kerja (?:dari|jarak) "
    r"(?:rumah|jauh)|distributed)\b",
    re.IGNORECASE,
)


def _key(value: str) -> str:
    folded = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    return " ".join(re.sub(r"[^a-z0-9]+", " ", folded.lower()).split())


@cache
def _country_index() -> dict[str, str]:
    index: dict[str, str] = {}
    for line in _COUNTRIES.strip().splitlines():
        code, *names = line.split("|")
        for name in names:
            index.setdefault(_key(name), code)
    return index


@cache
def _province_index() -> dict[str, str]:
    index: dict[str, str] = {}
    for entry in ID_PROVINCES:
        names = entry.split("|")
        for name in names:
            index[_key(name)] = names[0]
    index[_key("Jakarta")] = "DKI Jakarta"
    index[_key("Yogyakarta")] = "DI Yogyakarta"
    return index


def country_code(name: str | None) -> str | None:
    """ISO 3166-1 alpha-2 for a country name/alias or code (`"Indonesia"` → `"ID"`)."""
    if not name:
        return None
    text = name.strip()
    if re.fullmatch(r"[A-Za-z]{2}", text):
        upper = text.upper()
        if upper in _codes():
            return upper
    return _country_index().get(_key(text))


@cache
def _codes() -> frozenset[str]:
    return frozenset(line.split("|", 1)[0] for line in _COUNTRIES.strip().splitlines())


def us_state(name: str | None) -> str | None:
    """The US state name for a 2-letter code or a state name, else None."""
    if not name:
        return None
    text = name.strip()
    if re.fullmatch(r"[A-Za-z]{2}", text):
        return US_STATES.get(text.upper())
    wanted = _key(text)
    for state in US_STATES.values():
        if _key(state) == wanted:
            return state
    return None


def id_province(name: str | None) -> str | None:
    if not name:
        return None
    return _province_index().get(_key(name))
