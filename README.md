# Penalty Championship - Supabase Shootout ⚽

Gra zręcznościowa rzutów karnych w perspektywie 3D, zintegrowana z backendem w **FastAPI** i bazą danych **Supabase** (PostgreSQL + Auth + Kong Gateway).

**Graj online:** [https://bunny-earache-gratified.ngrok-free.dev/](https://bunny-earache-gratified.ngrok-free.dev/)

---

## 🌟 Funkcje i Ulepszenia

### 🎮 Rozgrywka & Fizyka
* **Dynamiczna Trajektoria 3D:** Symulacja rzutów karnych z wykorzystaniem fizycznego modelu lotu piłki uwzględniającego grawitację, opór powietrza, a także **efekt Magnusa** (podkręcenie piłki w locie zależne od kierunku strzału).
* **Fizyka Bramki (Siatki):** Piłka wpada *w głąb* bramki (obsługa głębokości siatki `netDepth`). Siatka dynamicznie odkształca się w trójwymiarze w punkcie uderzenia piłki, a następnie wyhamowuje piłkę, która naturalnie opada na murawę. Bramka nie zachowuje się już jak płaska ściana.
* **Klasyczny Bramkarz:** Bramkarz rzuca się w losowe sektory bramki (wersja oparta na losowych sektorach), co zapewnia klasyczny i zbalansowany poziom trudności.
* **Fizyka Squash & Stretch:** Piłka ulega elastycznej deformacji podczas lotu (rozciąganie przy wysokiej prędkości) oraz spłaszczeniu przy uderzeniach o słupki lub podłoże, nadając grze dynamiczny, kreskówkowy styl.

### 📊 Tabela Wyników (Leaderboard)
* **Zawsze dopasowana do ekranu:** Tabela ma dokładnie taką samą wysokość co okno gry, a długa lista graczy jest w pełni scrollowalna wewnątrz szklanego panelu (brak ucinania tekstu lub pojawiania się trzech kropek przy szerokich liczbach).
* **Dynamiczne wyszukiwanie:** Wyszukiwarka filtruje graczy na żywo po nazwie (pseudonimie) lub adresie email.
* **Wyróżnienie zalogowanego konta:** Wiersz z aktualnie zalogowanym graczem jest wyraźnie podświetlony neonowym kolorem.
* **Baza danych 300+ zawodników:** Baza została zasilona ponad 300 piłkarzami, w tym największymi gwiazdami futbolu (m.in. Robert Lewandowski, Lionel Messi, Cristiano Ronaldo, Kylian Mbappé, Erling Haaland, Ronaldinho, Zinedine Zidane itp.).
* **Bezpieczeństwo danych:** Kolumna hasła została usunięta z widoku tabeli na froncie, lecz hasła pozostają bezpiecznie przechowywane w bazie danych.

---

## 🛠️ Uruchomienie lokalne (Development)

Wymagany jest zainstalowany **Docker** oraz **Docker Compose**.

1. **Generowanie kluczy i konfiguracja:**
   Uruchom skrypt generujący unikalne klucze JWT i hasła dla Twojego konta Supabase:
   ```bash
   python generate_secrets.py
   ```
   Skrypt stworzy na bazie szablonu `.env.example` plik `.env` zawierający wygenerowane sekrety.

2. **Uruchomienie kontenerów:**
   ```bash
   docker compose up -d
   ```
   Docker uruchomi pełne środowisko Supabase (Database, Auth, Studio, Storage, Kong Gateway) oraz serwer FastAPI.

3. **Dostęp do aplikacji:**
   * Gra i API: [http://localhost:8888](http://localhost:8888)
   * Panel Supabase Studio (dashboard bazy danych): [http://localhost:3000](http://localhost:3000)

### 🌐 Integracja z zewnętrznym / chmurowym Supabase (Hosted Supabase)

Jeśli chcesz połączyć aplikację z zewnętrznym projektem Supabase (np. w chmurze Supabase), wykonaj następujące kroki:

1. W pliku `.env` podmień klucze i URL na dane swojego projektu (znajdziesz je w *Project Settings -> API* w panelu Supabase):
   ```env
   # Zmień adres na główny URL swojego projektu (bez '/rest/v1' na końcu)
   SUPABASE_URL=https://twoj-id-projektu.supabase.co
   
   # Podmień anon key
   ANON_KEY=twoj-supabase-anon-key
   ```
2. Zbuduj i uruchom ponownie kontener FastAPI:
   ```bash
   docker compose up -d --build web-server
   ```
   *Uwaga: Plik `.env` z Twoimi poufnymi kluczami jest chroniony przed wysłaniem na GitHub przez `.gitignore`.*

---

## 🐍 Skrypty pomocnicze (w folderze `server/`)

W celach administracyjnych w folderze `server/` umieszczone zostały skrypty ułatwiające zarządzanie bazą użytkowników:

* **Podgląd zarejestrowanych kont:**
  ```bash
  docker compose exec web-server python check_auth_users.py
  ```
  Wyświetla listę użytkowników zarejestrowanych w systemie Auth Supabase oraz w publicznej tabeli statystyk. Automatycznie wczytuje hasło bazy z pliku `.env`.

* **Usuwanie kont testowych:**
  ```bash
  docker compose exec web-server python delete_test_users.py email@domena.com
  ```
  Pozwala szybko i bezpiecznie usunąć dowolnego użytkownika o podanym adresie email z modułu autoryzacji oraz tabeli statystyk.

---

## 📄 Licencja

Projekt stworzony w celach demonstracyjnych połączenia FastAPI z ekosystemem Supabase. Wszystkie dane są generowane lokalnie i chronione przed upublicznieniem (plik `.env` oraz pliki binarne bazy danych zostały dodane do `.gitignore`).
