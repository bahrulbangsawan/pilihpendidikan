"""Control classification and page lexicons (18 §6.2, §7.7, §8, §10).

Buttons and links get a `role_hint` from their (untrusted) text, ARIA label and a few
structural facts the extraction script reports. The lexicon covers 13 languages:
English, Indonesian, Malay, Spanish, Portuguese, French, German, Italian, Dutch, Polish,
Turkish, Japanese, Chinese and Korean.

Safety rules baked in:

- a submit-type button whose text is not clearly "next / back / add / remove / upload /
  cookie" is classified `submit`, so it can only ever be clicked through the submit gate;
- "Apply" inside a form that has application fields is `submit`, never `apply_entry`;
- links that are not part of a form or wizard are `navigation` (never candidates).
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any, Final, Literal

RoleHint = Literal[
    "next",
    "previous",
    "submit",
    "add_section",
    "remove_section",
    "upload_trigger",
    "apply_entry",
    "login",
    "sign_up",
    "cookie_consent_accept",
    "cookie_consent_reject",
    "navigation",
    "other",
]


def _words(*phrases: str) -> re.Pattern[str]:
    escaped = sorted((re.escape(p) for p in phrases), key=len, reverse=True)
    return re.compile(r"(?:^|[^\w])(?:" + "|".join(escaped) + r")(?:$|[^\w])", re.IGNORECASE)


def _cjk(*phrases: str) -> re.Pattern[str]:
    return re.compile("|".join(re.escape(p) for p in phrases))


COOKIE_REJECT: Final = _words(
    "reject",
    "reject all",
    "decline",
    "decline all",
    "refuse",
    "deny",
    "necessary only",
    "only necessary",
    "essential only",
    "only essential",
    "use necessary cookies only",
    "strictly necessary only",
    "tolak",
    "tolak semua",
    "hanya yang diperlukan",
    "rechazar",
    "rechazar todo",
    "solo necesarias",
    "recusar",
    "rejeitar",
    "apenas necessários",
    "refuser",
    "tout refuser",
    "continuer sans accepter",
    "ablehnen",
    "alle ablehnen",
    "nur notwendige",
    "rifiuta",
    "rifiuta tutto",
    "solo necessari",
    "weigeren",
    "alles weigeren",
    "alleen noodzakelijk",
    "odrzuć",
    "odrzuć wszystkie",
    "reddet",
    "tümünü reddet",
)
COOKIE_REJECT_CJK: Final = _cjk(
    "拒否", "すべて拒否", "拒绝", "全部拒绝", "拒絕", "거부", "모두 거부"
)
COOKIE_ACCEPT: Final = _words(
    "accept",
    "accept all",
    "allow all",
    "allow cookies",
    "agree",
    "i agree",
    "got it",
    "ok",
    "okay",
    "terima",
    "terima semua",
    "setuju",
    "izinkan",
    "aceptar",
    "aceptar todo",
    "aceitar",
    "aceitar todos",
    "accepter",
    "tout accepter",
    "akzeptieren",
    "alle akzeptieren",
    "zustimmen",
    "accetta",
    "accetta tutto",
    "accepteren",
    "alles accepteren",
    "akceptuj",
    "zaakceptuj",
    "kabul et",
    "tümünü kabul et",
)
COOKIE_ACCEPT_CJK: Final = _cjk("同意", "すべて受け入れる", "接受", "全部接受", "동의", "모두 수락")

NEXT: Final = _words(
    "next",
    "next step",
    "continue",
    "save and continue",
    "save & continue",
    "proceed",
    "review",
    "review application",
    "go to next step",
    "lanjut",
    "lanjutkan",
    "berikutnya",
    "selanjutnya",
    "seterusnya",
    "teruskan",
    "siguiente",
    "continuar",
    "seguinte",
    "próximo",
    "suivant",
    "continuer",
    "weiter",
    "fortfahren",
    "avanti",
    "continua",
    "volgende",
    "doorgaan",
    "dalej",
    "kontynuuj",
    "devam",
    "ileri",
    "sonraki",
)
NEXT_CJK: Final = _cjk("次へ", "続行", "下一步", "继续", "繼續", "다음", "계속")
PREVIOUS: Final = _words(
    "back",
    "previous",
    "prev",
    "go back",
    "previous step",
    "kembali",
    "sebelumnya",
    "atrás",
    "anterior",
    "volver",
    "voltar",
    "précédent",
    "retour",
    "zurück",
    "indietro",
    "precedente",
    "terug",
    "vorige",
    "wstecz",
    "poprzedni",
    "geri",
    "önceki",
)
PREVIOUS_CJK: Final = _cjk("戻る", "前へ", "上一步", "返回", "이전", "뒤로")
SUBMIT: Final = _words(
    "submit",
    "submit application",
    "confirm",
    "confirm and submit",
    "confirm application",
    "submit my application",
    "send application",
    "send my application",
    "complete application",
    "finish application",
    "finish",
    "apply",
    "apply now",
    "send",
    "kirim",
    "kirim lamaran",
    "ajukan lamaran",
    "hantar",
    "enviar",
    "enviar solicitud",
    "enviar candidatura",
    "postular",
    "candidatar",
    "envoyer",
    "envoyer ma candidature",
    "postuler",
    "absenden",
    "bewerbung absenden",
    "senden",
    "jetzt bewerben",
    "invia",
    "invia candidatura",
    "candidati",
    "verzenden",
    "solliciteren",
    "versturen",
    "wyślij",
    "aplikuj",
    "gönder",
    "başvur",
    "başvuruyu gönder",
)
SUBMIT_CJK: Final = _cjk("送信", "応募する", "提交", "提交申请", "提交申請", "제출", "지원하기")
APPLY_ENTRY: Final = _words(
    "apply",
    "apply now",
    "apply for this job",
    "apply for this position",
    "apply to this job",
    "i'm interested",
    "im interested",
    "start application",
    "begin application",
    "lamar",
    "lamar sekarang",
    "melamar",
    "daftar sekarang",
    "mohon",
    "aplicar",
    "solicitar",
    "postularme",
    "postular",
    "candidatar-se",
    "candidatar",
    "postuler",
    "jetzt bewerben",
    "bewerben",
    "candidati",
    "candidatati",
    "solliciteer",
    "solliciteren",
    "aplikuj",
    "başvur",
    "hemen başvur",
)
APPLY_ENTRY_CJK: Final = _cjk("応募", "申请", "申請", "지원")
ADD_SECTION: Final = _words(
    "add",
    "add another",
    "add more",
    "add education",
    "add experience",
    "add position",
    "add school",
    "+ add",
    "tambah",
    "tambahkan",
    "añadir",
    "agregar",
    "adicionar",
    "ajouter",
    "hinzufügen",
    "aggiungi",
    "toevoegen",
    "dodaj",
    "ekle",
)
ADD_SECTION_CJK: Final = _cjk("追加", "添加", "추가")
REMOVE_SECTION: Final = _words(
    "remove",
    "delete",
    "hapus",
    "eliminar",
    "quitar",
    "remover",
    "excluir",
    "supprimer",
    "retirer",
    "entfernen",
    "löschen",
    "rimuovi",
    "elimina",
    "verwijderen",
    "usuń",
    "sil",
    "kaldır",
)
REMOVE_SECTION_CJK: Final = _cjk("削除", "删除", "刪除", "삭제")
UPLOAD: Final = _words(
    "upload",
    "upload file",
    "upload resume",
    "upload cv",
    "attach",
    "attach resume",
    "attach file",
    "choose file",
    "browse",
    "select file",
    "unggah",
    "lampirkan",
    "pilih file",
    "subir",
    "adjuntar",
    "carregar",
    "anexar",
    "télécharger",
    "joindre",
    "hochladen",
    "datei auswählen",
    "carica",
    "allega",
    "uploaden",
    "bijvoegen",
    "prześlij",
    "załącz",
    "yükle",
    "dosya seç",
)
UPLOAD_CJK: Final = _cjk("アップロード", "ファイルを選択", "上传", "上傳", "업로드", "파일 선택")
LOGIN: Final = _words(
    "sign in",
    "log in",
    "login",
    "signin",
    "sign in to apply",
    "masuk",
    "log masuk",
    "iniciar sesión",
    "entrar",
    "acessar",
    "se connecter",
    "connexion",
    "anmelden",
    "einloggen",
    "accedi",
    "inloggen",
    "zaloguj",
    "giriş yap",
    "oturum aç",
)
LOGIN_CJK: Final = _cjk("ログイン", "登录", "登入", "로그인")
SIGN_UP: Final = _words(
    "sign up",
    "create account",
    "create an account",
    "register",
    "join now",
    "daftar",
    "buat akun",
    "registrarse",
    "crear cuenta",
    "criar conta",
    "cadastrar",
    "s'inscrire",
    "créer un compte",
    "registrieren",
    "konto erstellen",
    "registrati",
    "crea account",
    "registreren",
    "account aanmaken",
    "zarejestruj",
    "kayıt ol",
    "hesap oluştur",
)
SIGN_UP_CJK: Final = _cjk("新規登録", "アカウント作成", "注册", "註冊", "회원가입", "계정 만들기")

#: Generic confirmation lexicon (18 §10), 13 languages.
CONFIRMATION: Final = re.compile(
    r"thank you for (applying|your application|your interest)|thanks for applying|"
    r"application (has been |was )?(submitted|received|sent)|"
    r"we (have|'ve) received your application|"
    r"your application (has been|was) (submitted|received|sent)|"
    r"terima kasih (telah|sudah) melamar|lamaran (anda )?(telah|sudah) (dikirim|diterima)|"
    r"permohonan anda telah (dihantar|diterima)|"
    r"gracias por (postular|tu solicitud|su solicitud|aplicar)|solicitud (enviada|recibida)|"
    r"obrigad[oa] por (se candidatar|sua candidatura)|candidatura (enviada|recebida)|"
    r"merci pour votre candidature|candidature (envoyée|reçue)|"
    r"vielen dank für ihre bewerbung|"
    r"bewerbung (wurde )?(erfolgreich )?(gesendet|eingegangen|übermittelt)|"
    r"grazie per (la tua candidatura|aver inviato)|candidatura (inviata|ricevuta)|"
    r"bedankt voor je sollicitatie|sollicitatie (is )?(verzonden|ontvangen)|"
    r"dziękujemy za (aplikację|zgłoszenie)|aplikacja (została )?wysłana|"
    r"başvurunuz (alındı|gönderildi)|başvurunuz için teşekkür|"
    r"ご応募ありがとうございます|応募が完了しました|感谢您的申请|申请已提交|申請已提交|"
    r"지원해 주셔서 감사합니다|지원이 완료되었습니다",
    re.IGNORECASE,
)

_SUBMIT_HINT_RE: Final = re.compile(r"submit|apply|send|finish|complete", re.IGNORECASE)


def _hit(text: str, pattern: re.Pattern[str], cjk: re.Pattern[str] | None = None) -> bool:
    if pattern.search(text):
        return True
    return bool(cjk is not None and cjk.search(text))


#: Destructive or unrelated account actions are never anything but `other`.
DESTRUCTIVE: Final = re.compile(
    r"withdraw|delete (my )?(account|application|profile)|cancel (my )?application|"
    r"unsubscribe|deactivate|tarik lamaran|hapus akun|batalkan lamaran",
    re.IGNORECASE,
)


def classify_control(control: Mapping[str, Any]) -> RoleHint:
    """`role_hint` of one extracted control (see the module docstring for the rules)."""
    text = " ".join(str(control.get(key) or "") for key in ("text", "aria_label")).strip()
    kind = str(control.get("kind") or "button")
    in_form = bool(control.get("in_form"))
    form_has_fields = bool(control.get("form_has_fields"))
    in_wizard = bool(control.get("in_wizard"))
    if DESTRUCTIVE.search(text):
        return "other"
    if control.get("upload_for"):
        return "upload_trigger"
    if control.get("in_cookie_banner"):
        if _hit(text, COOKIE_REJECT, COOKIE_REJECT_CJK):
            return "cookie_consent_reject"
        if _hit(text, COOKIE_ACCEPT, COOKIE_ACCEPT_CJK):
            return "cookie_consent_accept"
        return "other"
    if _hit(text, SIGN_UP, SIGN_UP_CJK):
        return "sign_up"
    if _hit(text, LOGIN, LOGIN_CJK):
        return "login"
    if _hit(text, PREVIOUS, PREVIOUS_CJK):
        return "previous"
    if _hit(text, REMOVE_SECTION, REMOVE_SECTION_CJK):
        return "remove_section"
    if _hit(text, UPLOAD, UPLOAD_CJK):
        return "upload_trigger" if kind != "link" else "other"
    if _hit(text, ADD_SECTION, ADD_SECTION_CJK) and kind != "submit":
        return "add_section"
    if _hit(text, NEXT, NEXT_CJK):
        return "next"
    apply_like = _hit(text, APPLY_ENTRY, APPLY_ENTRY_CJK)
    submit_like = _hit(text, SUBMIT, SUBMIT_CJK)
    if form_has_fields and (submit_like or apply_like):
        return "submit"
    if kind == "submit" and form_has_fields:
        return "submit"  # unknown submit buttons only ever go through the submit gate
    if apply_like and not form_has_fields:
        return "apply_entry"
    if submit_like and kind != "link" and (in_form or in_wizard):
        return "submit"
    if kind == "submit" and (in_form or _SUBMIT_HINT_RE.search(str(control.get("hint") or ""))):
        return "submit"  # an unrecognized form-submit button is only ever clicked via the gate
    if kind == "link":
        return "navigation"
    return "other"


def is_confirmation_text(text: str | None) -> bool:
    return bool(text and CONFIRMATION.search(text))
