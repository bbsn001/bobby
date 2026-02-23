# Bobby Bird 🐦

Flappy Bird w przeglądarce — vanilla JS + Canvas API, bez zewnętrznych bibliotek.

## Jak grać

| Akcja | Sterowanie |
|-------|-----------|
| Skok | **Spacja** / kliknięcie / tap |
| Start | Tap lub Spacja na ekranie startowym |
| Restart | Tap po game over (lub poczekaj 3s) |

## Mechanika

- Przelec przez przerwę między rurami i **dotknij chmurki** (score.jpg) aby zdobyć punkt
- Licznik **Deaths: X/10** — po 10 śmierciach pojawia się ekran **YOU LOSE 😂**
- Licznik śmierci resetuje się po odświeżeniu strony

## GitHub Pages

1. Wrzuć repozytorium na GitHub
2. Wejdź w **Settings → Pages → Source: main / root**
3. Gra dostępna pod `https://<user>.github.io/<repo>/flappy_web/`

## Struktura

```
flappy_web/
├── index.html        # cała gra (HTML + CSS + JS)
└── assets/
    ├── player.jpg    # sprite gracza
    ├── score.jpg     # zbieralna chmurka
    ├── music.mp3     # muzyka w tle
    └── kaching.wav   # dźwięk przy zebraniu punktu
```
