# Kaland · Játék · Kockázat – telefonon

Lapozgatós kalandkönyvek (Kaland Játék Kockázat / Fighting Fantasy) játszása telefonon.
A játék a könyv szövegét mutatja, a végén számozott gombokkal választasz; a kockát, a harcot,
a tárgyakat és az eseménynaplót a játék vezeti.

**Megnyitás:** https://m00nsc0rched.github.io/kaland/

## Telepítés iPhone-ra

1. Nyisd meg a fenti címet **Safariban**.
2. Koppints a Megosztás gombra, majd a **Főképernyőhöz adás** pontra.
3. A főképernyőn megjelenő **KJK** ikonról teljes képernyőn indul, internet nélkül is.

Androidon a Chrome menüjében az „Alkalmazás telepítése” pont ugyanezt teszi.

## Könyv betöltése

A könyvek **nem részei** ennek a tárolónak. A zagor.hu
[letöltések oldaláról](https://zagor.hu/index.php?oldal=letoltes) letöltött PDF-et a
**Könyv betöltése** gombbal töltheted be:

- Szkennelt PDF esetén a játék szövegfelismeréssel olvassa be (asztali gépen 3–5 perc).
- A beolvasott könyvet a **Mentés fájlba (.kjk.json)** gombbal elmentheted, és a telefonon
  ezt a fájlt töltheted be (pl. iCloud Drive-ból), így ott nem kell újra felismerni.
- A beépített **próbakaland** könyv nélkül is kipróbálható.

## Kezelés

- **Első koppintás** egy számozott gombon: zöld keretet kap, és a szövegben kiemelődik a választás.
  **Második koppintás:** továbblapozás.
- **Menü** (bal felső piros gomb): Kalandlap, Tárgyak és jegyzetek, Eseménynapló, Lapozás számra
  (betű→szám átváltással a titkos fejezetpontokhoz), Kockadobás, Bevezető és szabályok, Új kör, Könyvtár.
- Szerencse- és ügyességpróba, kockadobás, harc (egy vagy több ellenféllel, szerencsével, meneküléssel):
  a próbától függő választások addig zárva vannak, amíg nem dobtál; a „Kézi döntés” feloldja őket.
- A feltétel nélküli pontváltozásokat („Vesztesz 2 ÉLETERŐ pontot”) a játék automatikusan végrehajtja,
  és visszavonhatók.
- Ha elfogy az ÉLETERŐD, vagy halálos fejezetponthoz érsz, a kör véget ér; új körben új karaktert dobsz.

A mentések és a betöltött könyvek abban a böngészőben (illetve a főképernyős alkalmazásban) maradnak,
ahol játszol.

## Helyi futtatás

```powershell
powershell -ExecutionPolicy Bypass -File serve.ps1
```

Ezután: http://localhost:8782/kaland/ (a szkript a szülőmappát szolgálja ki).

## Felépítés

| Fájl | Szerep |
|---|---|
| `index.html`, `css/app.css` | felület |
| `js/app.js` | játékmenet, menü, napló, mentés |
| `js/analyze.js` | a fejezetpontok szövegéből választások, próbák, ellenfelek, pontváltozások |
| `js/layout.js` | OCR-sorokból számozott fejezetpontok |
| `js/importer.js` | PDF beolvasása (pdf.js), szövegfelismerés (Tesseract.js, magyar) |
| `js/rules.js` | kockák, karakteralkotás, próbák, harci kör |
| `js/store.js` | IndexedDB / localStorage |
| `js/demo.js` | beépített próbakaland |
| `sw.js`, `manifest.webmanifest`, `icons/` | telepíthető, offline webapp |
