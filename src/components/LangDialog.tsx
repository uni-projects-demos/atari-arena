import {
  type ChangeEvent,
  type JSX,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useI18n } from "@/i18n";
import { Input } from "./ui/input";

interface LangInfo {
  code: string;
  native: string;
  english: string;
}

const FB_ENG_LANGS: Record<string, string> = {
  gkm: "Byzantine Greek",
};

const FB_LANGS: Record<string, string> = {
  gkm: "Ῥωμαϊκή",
  hit: "nešili",
  gez: "ግዕዝ",
  gmy: "Mycenaean Greek",
  otk: "𐱅𐰇𐰼𐰜",
  oui: "Uyγur",
  chg: "چغتای تیلی",
  och: "上古漢語",
  ltc: "中古漢語",
  ojp: "上代日本語",
  oty: "பழந்தமிழ்",
  xct: "བོད་སྐད་རྙིང་",
  nwc: "Classical Newar",
  oge: "ძველი ქართული",
  sam: "Samaritan Aramaic",
  dum: "Dietsc",
  ofs: "Aldfrysk",
  osp: "castellano antiguo",
  pro: "occitan ancian",
  kaw: "Bhāṣa Kawi",
  akk: "akkadûm",
  ang: "Ænglisc",
  arc: "ארמית",
  arn: "Mapudungun",
  ast: "asturianu",
  ban: "Basa Bali",
  bem: "Ichibemba",
  brx: "बर’",
  chr: "ᏣᎳᎩ",
  cop: "Ⲙⲉⲧⲣⲉⲙⲛ̀ⲭⲏⲙⲓ",
  doi: "डोगरी",
  egy: "r n Kmt",
  enm: "Englissh",
  frm: "françois",
  fro: "franceis",
  fur: "furlan",
  gmh: "diutsch",
  goh: "diutisk",
  got: "𐌲𐌿𐍄𐌹𐍃𐌺𐌰",
  grc: "Ἑλληνική",
  haw: "ʻŌlelo Hawaiʻi",
  hbo: "עִבְרִית מִקְרָאִית",
  hil: "Hiligaynon",
  kab: "Taqbaylit",
  kha: "Khasi",
  kok: "कोंकणी",
  lad: "Djudeo-espanyol",
  lmo: "lombard",
  lzh: "文言",
  mad: "Bhâsa Madhurâ",
  mga: "Gaoidhealg",
  min: "Baso Minangkabau",
  nap: "napulitano",
  nci: "Nāhuatlahtōlli",
  nds: "Plattdüütsch",
  non: "Norrœnt mál",
  orv: "древнерусскъ ѩзыкъ",
  osx: "sahsisk",
  ota: "لسان عثمانی",
  pal: "pārsīk",
  pam: "Kapampangan",
  peo: "ariya",
  phn: "𐤐𐤍𐤉𐤕",
  quc: "K’iche’",
  qya: "Quenya",
  rom: "Romani čhib",
  sat: "ᱥᱟᱱᱛᱟᱲᱤ",
  scn: "sicilianu",
  sco: "Scots",
  sga: "Goídelc",
  sjn: "Sindarin",
  sux: "eme-ĝir₁₅",
  syc: "ܠܫܢܐ ܣܘܪܝܝܐ",
  szl: "ślōnskŏ gŏdka",
  tcy: "ತುಳು",
  tlh: "tlhIngan Hol",
  tzm: "Tamaziɣt",
  uga: "𐎜𐎂𐎗𐎚",
  vec: "vèneto",
  war: "Winaray",
  xcl: "գրաբար",
  aa: "Qafar af",
  ab: "Аҧсуа",
  ae: "Avestan",
  an: "aragonés",
  av: "авар мацӀ",
  ay: "Aymar aru",
  ayr: "Aymar aru",
  ba: "башҡорт теле",
  bi: "Bislama",
  bho: "भोजपुरी",
  bo: "བོད་སྐད་",
  br: "brezhoneg",
  ce: "нохчийн мотт",
  ch: "Chamoru",
  co: "corsu",
  cr: "ᓀᐦᐃᔭᐍᐏᐣ",
  cu: "словѣньскъ ѩзыкъ",
  cv: "чӑваш чӗлхи",
  dv: "ދިވެހި",
  dz: "རྫོང་ཁ",
  ff: "Fulfulde",
  fj: "Na Vosa Vakaviti",
  fo: "føroyskt",
  fy: "Frysk",
  gv: "Gaelg",
  ho: "Hiri Motu",
  hz: "Otjiherero",
  ia: "interlingua",
  ie: "Interlingue",
  ii: "ꆈꌠꉙ",
  ik: "Iñupiaq",
  io: "Ido",
  iu: "ᐃᓄᒃᑎᑐᑦ",
  kg: "Kikongo",
  ki: "Gĩkũyũ",
  kj: "Oshikwanyama",
  kl: "kalaallisut",
  kr: "Kanuri",
  ks: "کٲشُر",
  kv: "коми кыв",
  kw: "Kernewek",
  la: "Latina",
  li: "Limburgs",
  lu: "Tshiluba",
  lus: "Mizo ṭawng",
  mh: "Kajin M̧ajeļ",
  mni: "ꯃꯤꯇꯩ ꯂꯣꯟ",
  na: "Dorerin Naoero",
  nb: "norsk bokmål",
  nd: "isiNdebele",
  ng: "Oshindonga",
  nn: "norsk nynorsk",
  nr: "isiNdebele",
  nv: "Diné bizaad",
  oc: "occitan",
  oj: "Anishinaabemowin",
  os: "ирон æвзаг",
  pi: "Pāli",
  rm: "rumantsch",
  rn: "Ikirundi",
  sc: "sardu",
  se: "davvisámegiella",
  sg: "Sängö",
  sh: "srpskohrvatski",
  ss: "siSwati",
  tl: "Tagalog",
  tn: "Setswana",
  to: "lea fakatonga",
  tw: "Twi",
  ty: "reo Tahiti",
  ve: "Tshivenda",
  vo: "Volapük",
  wa: "walon",
  wo: "Wolof",
  yue: "粵語",
  za: "Vahcuengh",
};

function langName(code: string, displayLocale: string): string {
  const fallback: string =
    displayLocale === "en"
      ? (FB_ENG_LANGS[code] ?? FB_LANGS[code] ?? code)
      : (FB_LANGS[code] ?? code);
  try {
    const displayed: string | undefined = new Intl.DisplayNames([displayLocale], {
      type: "language",
    }).of(code);
    return displayed && displayed !== code ? displayed : fallback;
  } catch {
    return fallback;
  }
}

function norm(val: string): string {
  return val.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

interface LangDialogProps {
  dialogRef: RefObject<HTMLDialogElement | null>;
  isOpen: boolean;
  onClose: () => void;
}

export default function LangDialog({ dialogRef, isOpen, onClose }: LangDialogProps) {
  const { locale, locales, setLocale, t } = useI18n();
  const [query, setQuery] = useState("");
  const searchRef: RefObject<HTMLInputElement | null> = useRef<HTMLInputElement>(null);

  const langs: LangInfo[] = useMemo(
    (): LangInfo[] =>
      locales.map(
        (code: string): LangInfo => ({
          code,
          native: FB_LANGS[code] ?? langName(code, code),
          english: langName(code, "en"),
        }),
      ),
    [locales],
  );

  const normQuery: string = norm(query.trim());
  const filteredLangs: LangInfo[] = langs.filter(({ code, native, english }: LangInfo): boolean =>
    norm(`${native} ${english} ${code}`).includes(normQuery),
  );

  useEffect((): void => {
    if (!isOpen) return;
    setQuery("");
    requestAnimationFrame((): void => searchRef.current?.focus());
  }, [isOpen]);

  const close: () => void = (): void => dialogRef.current?.close();

  const onDialogClick: (event: MouseEvent<HTMLDialogElement>) => void = (
    event: MouseEvent<HTMLDialogElement>,
  ): void => {
    if (event.target !== event.currentTarget) return;
    const box: DOMRect = event.currentTarget.getBoundingClientRect();
    if (
      event.clientX < box.left ||
      event.clientX > box.right ||
      event.clientY < box.top ||
      event.clientY > box.bottom
    ) {
      close();
    }
  };

  const onDialogKeyDown: (event: KeyboardEvent<HTMLDialogElement>) => void = (
    event: KeyboardEvent<HTMLDialogElement>,
  ): void => {
    if (event.key === "Escape") close();
  };

  return (
    <dialog
      id="language-dialog"
      ref={dialogRef}
      className="language-dialog"
      aria-labelledby="language-heading"
      onClose={onClose}
      onClick={onDialogClick}
      onKeyDown={onDialogKeyDown}
    >
      <div className="language-heading">
        <h2 id="language-heading">{t("i18n.language")}</h2>
        <button
          type="button"
          className="dialog-close"
          aria-label={t("i18n.close")}
          title={t("i18n.close")}
          onClick={close}
        >
          ×
        </button>
      </div>

      <label className="language-search-label" htmlFor="language-search">
        {t("i18n.searchLanguages")}
      </label>
      <Input
        ref={searchRef}
        id="language-search"
        type="search"
        autoComplete="off"
        spellCheck={false}
        aria-controls="language-options"
        value={query}
        onChange={(event: ChangeEvent<HTMLInputElement>): void => setQuery(event.target.value)}
      />

      <div id="language-options" className="language-options" translate="no">
        {filteredLangs.map(
          ({ code, native }: LangInfo): JSX.Element => (
            <button
              key={code}
              type="button"
              className="language-option"
              data-locale={code}
              aria-pressed={code === locale}
              onClick={(): void => {
                setLocale(code);
                close();
              }}
            >
              <span lang={code} dir="auto">
                {native}
              </span>
              <small dir="ltr">{code.toUpperCase()}</small>
            </button>
          ),
        )}
      </div>

      {filteredLangs.length === 0 && <p className="language-empty">{t("i18n.noLanguagesFound")}</p>}
    </dialog>
  );
}
