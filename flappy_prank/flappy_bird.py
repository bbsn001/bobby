#!/usr/bin/env python3
"""
Flappy Bird — with a secret prank on game over  :)
Drop player.jpg and music.mp3 into the assets/ folder before running.
"""

import pygame
import sys
import os
import io
import math
import random
import subprocess
import time

# ---------------------------------------------------------------------------
# Path helpers
# ---------------------------------------------------------------------------

def resource_path(rel: str) -> str:
    """Works in both dev mode and PyInstaller --onefile bundle."""
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, rel)


def find_prank_exe():
    """Try several locations for prank.exe; return first found path or None."""
    if hasattr(sys, "_MEIPASS"):
        base = os.path.dirname(sys.executable)           # compiled: exe dir
    else:
        base = os.path.dirname(os.path.abspath(__file__))  # dev: script dir

    candidates = [
        os.path.normpath(os.path.join(base, "system_update.exe")),                  # same dir
        os.path.normpath(os.path.join(base, "..", "prank", "system_update.exe")),   # sibling folder
        os.path.normpath(os.path.join(base, "prank", "system_update.exe")),         # sub-folder
    ]
    for path in candidates:
        if os.path.isfile(path):
            return path
    return None


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

W, H          = 400, 600
FPS           = 60
GRAVITY       = 0.45
JUMP_FORCE    = -9.5
PIPE_SPEED    = 2.55           # -15% (was 3)
PIPE_GAP      = 175            # moderate gap (was 165)
PIPE_WIDTH    = 72
PIPE_INTERVAL = 1750           # slightly less frequent (was 1600)

DARK_NAVY   = (15,  20,  50)
STAR_COLOR  = (180, 200, 255)
GREEN       = (34,  180,  34)
DARK_GREEN  = (18,  120,  18)
WHITE       = (255, 255, 255)
RED         = (220,  50,  50)
YELLOW      = (255, 215,   0)
GRAY        = (160, 160, 160)

STAR_POS = [
    (40, 25), (110, 70), (185, 15), (260, 55), (340, 30),
    (70, 130), (310, 110), (150, 160), (380, 80), (20, 200),
    (230, 190), (90, 250), (360, 220),
]


# ---------------------------------------------------------------------------
# Image helper — remove white background
# ---------------------------------------------------------------------------

def load_player_image() -> pygame.Surface:
    """Load player.jpg, strip near-white pixels → transparent pygame Surface."""
    img_path = resource_path(os.path.join("assets", "player.jpg"))

    try:
        from PIL import Image

        pil_img = Image.open(img_path).convert("RGBA")
        pixels  = pil_img.load()
        w, h    = pil_img.size
        thresh  = 200  # RGB channels all above this → treat as white background

        for y in range(h):
            for x in range(w):
                r, g, b, a = pixels[x, y]
                if r >= thresh and g >= thresh and b >= thresh:
                    pixels[x, y] = (r, g, b, 0)

        # Convert PIL → pygame via in-memory PNG (no temp file)
        buf = io.BytesIO()
        pil_img.save(buf, format="PNG")
        buf.seek(0)
        return pygame.image.load(buf).convert_alpha()

    except ImportError:
        # Pillow not installed — plain load without transparency removal
        try:
            return pygame.image.load(img_path).convert_alpha()
        except Exception:
            pass
    except Exception:
        pass

    # Fallback: draw a yellow circle bird
    surf = pygame.Surface((60, 60), pygame.SRCALPHA)
    pygame.draw.circle(surf, YELLOW,        (30, 30), 28)
    pygame.draw.circle(surf, (200, 160, 0), (30, 30), 28, 3)
    pygame.draw.circle(surf, (40,  30,  0), (38, 22),  6)
    return surf


def load_gap_image() -> pygame.Surface:
    """Load score.jpg, strip near-white pixels, scale to 70 px wide."""
    img_path = resource_path(os.path.join("assets", "score.jpg"))
    try:
        from PIL import Image

        pil_img = Image.open(img_path).convert("RGBA")
        pixels  = pil_img.load()
        w, h    = pil_img.size
        thresh  = 200

        for y in range(h):
            for x in range(w):
                r, g, b, a = pixels[x, y]
                if r >= thresh and g >= thresh and b >= thresh:
                    pixels[x, y] = (r, g, b, 0)

        buf = io.BytesIO()
        pil_img.save(buf, format="PNG")
        buf.seek(0)
        surf = pygame.image.load(buf).convert_alpha()

    except ImportError:
        try:
            surf = pygame.image.load(img_path).convert_alpha()
        except Exception:
            return pygame.Surface((0, 0), pygame.SRCALPHA)
    except Exception:
        return pygame.Surface((0, 0), pygame.SRCALPHA)

    # Scale to 70 px wide, maintain aspect ratio
    target_w = 70
    target_h = max(1, int(surf.get_height() * target_w / surf.get_width()))
    return pygame.transform.smoothscale(surf, (target_w, target_h))


# ---------------------------------------------------------------------------
# Bird
# ---------------------------------------------------------------------------

class Bird:
    SIZE = 60

    def __init__(self, image: pygame.Surface):
        self.img = pygame.transform.smoothscale(image, (self.SIZE, self.SIZE))
        self.x   = 80
        self.y   = float(H // 2)
        self.vy  = 0.0

    def jump(self):
        self.vy = JUMP_FORCE

    def update(self):
        self.vy += GRAVITY
        self.y  += self.vy

    def rect(self) -> pygame.Rect:
        m = 8   # shrink hitbox slightly for fairness
        return pygame.Rect(
            self.x + m, int(self.y) + m,
            self.SIZE - m * 2, self.SIZE - m * 2,
        )

    def draw(self, surf: pygame.Surface):
        angle   = max(-35, min(50, -self.vy * 3))
        rotated = pygame.transform.rotate(self.img, angle)
        r = rotated.get_rect(
            center=(self.x + self.SIZE // 2, int(self.y) + self.SIZE // 2)
        )
        surf.blit(rotated, r)


# ---------------------------------------------------------------------------
# Pipe
# ---------------------------------------------------------------------------

class Pipe:
    CAP_H     = 28
    CAP_EXTRA = 10

    def __init__(self):
        gc             = random.randint(H // 4, H * 3 // 4)
        self.top_h     = gc - PIPE_GAP // 2
        self.bot_y     = gc + PIPE_GAP // 2
        self.x         = float(W)
        self.passed    = False
        self.collected = False   # True once player touches the cloud

    def update(self):
        self.x -= PIPE_SPEED

    def is_off_screen(self) -> bool:
        return self.x + PIPE_WIDTH < 0

    def rects(self):
        xi  = int(self.x)
        top = pygame.Rect(xi, 0, PIPE_WIDTH, self.top_h)
        bot = pygame.Rect(xi, self.bot_y, PIPE_WIDTH, H - self.bot_y)
        return top, bot

    def draw(self, surf: pygame.Surface):
        xi = int(self.x)
        cx = xi - self.CAP_EXTRA
        cw = PIPE_WIDTH + self.CAP_EXTRA * 2

        if self.top_h > 0:
            pygame.draw.rect(surf, GREEN, (xi, 0, PIPE_WIDTH, self.top_h))
            pygame.draw.rect(surf, DARK_GREEN,
                             (cx, self.top_h - self.CAP_H, cw, self.CAP_H))

        if self.bot_y < H:
            pygame.draw.rect(surf, GREEN,
                             (xi, self.bot_y, PIPE_WIDTH, H - self.bot_y))
            pygame.draw.rect(surf, DARK_GREEN,
                             (cx, self.bot_y, cw, self.CAP_H))


# ---------------------------------------------------------------------------
# Game
# ---------------------------------------------------------------------------

class Game:
    def __init__(self):
        pygame.init()
        self.screen = pygame.display.set_mode((W, H))
        pygame.display.set_caption("Flappy Bird")
        self.clock = pygame.time.Clock()

        self.font_huge  = pygame.font.SysFont("Arial", 52, bold=True)
        self.font_big   = pygame.font.SysFont("Arial", 36, bold=True)
        self.font_small = pygame.font.SysFont("Arial", 22)
        self.font_score = pygame.font.SysFont("Arial", 34, bold=True)

        # ── Player image (white background removed via PIL) ───────────────
        self.player_img = load_player_image()
        self.gap_img    = load_gap_image()

        # ── Kaching sound ─────────────────────────────────────────────────
        self.kaching_sound = None
        try:
            self.kaching_sound = pygame.mixer.Sound(
                resource_path(os.path.join("assets", "kaching.wav"))
            )
            self.kaching_sound.set_volume(0.7)
        except Exception:
            pass

        # ── Music ─────────────────────────────────────────────────────────
        self.has_music = False
        try:
            pygame.mixer.init()
            pygame.mixer.music.load(
                resource_path(os.path.join("assets", "music.mp3"))
            )
            pygame.mixer.music.set_volume(0.45)
            self.has_music = True
        except Exception:
            pass

        self.death_count = 0   # persists across restarts, resets only on game close

        self.reset()

    # ── Reset ─────────────────────────────────────────────────────────────

    def reset(self):
        self.bird           = Bird(self.player_img)
        self.pipes          = []
        self.score          = 0
        self.alive          = True
        self.waiting        = True   # show start screen until Space/click
        self.game_over_t    = None
        self.prank_launched = False
        self.pipe_timer     = 0

        if self.has_music:
            try:
                pygame.mixer.music.stop()
            except Exception:
                pass

    def _start_game(self):
        """Transition from start screen → active play."""
        self.waiting = False
        self.bird.jump()
        if self.has_music:
            try:
                pygame.mixer.music.play(-1)
            except Exception:
                pass

    # ── Events ────────────────────────────────────────────────────────────

    def handle_events(self):
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                pygame.quit()
                sys.exit()

            if event.type == pygame.KEYDOWN:
                if event.key == pygame.K_SPACE:
                    if self.waiting:
                        self._start_game()
                    elif self.alive:
                        self.bird.jump()
                    elif self._can_restart():
                        self.reset()
                if event.key == pygame.K_r and not self.alive:
                    self.reset()

            if event.type == pygame.MOUSEBUTTONDOWN:
                if self.waiting:
                    self._start_game()
                elif self.alive:
                    self.bird.jump()

    def _can_restart(self) -> bool:
        return (
            self.game_over_t is not None
            and (time.time() - self.game_over_t) >= 3.0
        )

    # ── Update ────────────────────────────────────────────────────────────

    def update(self):
        if self.waiting:
            return

        if not self.alive:
            if self._can_restart():
                self.reset()
            return

        dt = self.clock.get_time()

        self.bird.update()

        # Spawn pipes
        self.pipe_timer += dt
        if self.pipe_timer >= PIPE_INTERVAL:
            self.pipes.append(Pipe())
            self.pipe_timer = 0

        # Move pipes
        for pipe in self.pipes:
            pipe.update()
            if not pipe.passed and pipe.x + PIPE_WIDTH < self.bird.x:
                pipe.passed = True   # used only for off-screen cleanup reference

        self.pipes = [p for p in self.pipes if not p.is_off_screen()]

        br = self.bird.rect()

        # Cloud collection — score only when bird touches the gap image
        if self.gap_img.get_width() > 0:
            gw = self.gap_img.get_width()
            gh = self.gap_img.get_height()
            for pipe in self.pipes:
                if not pipe.collected:
                    gap_cx     = int(pipe.x) + PIPE_WIDTH // 2
                    gap_cy     = (pipe.top_h + pipe.bot_y) // 2
                    cloud_rect = pygame.Rect(
                        gap_cx - gw // 2, gap_cy - gh // 2, gw, gh
                    )
                    if br.colliderect(cloud_rect):
                        pipe.collected = True
                        self.score += 1
                        if self.kaching_sound:
                            self.kaching_sound.play()

        # Collision: floor / ceiling
        if self.bird.y > H or self.bird.y < -Bird.SIZE:
            self._die()
            return

        # Collision: pipes
        for pipe in self.pipes:
            for pr in pipe.rects():
                if br.colliderect(pr):
                    self._die()
                    return

    def _die(self):
        self.alive        = False
        self.game_over_t  = time.time()
        self.death_count += 1

        if self.has_music:
            try:
                pygame.mixer.music.stop()
            except Exception:
                pass

        # Launch the prank only on the 10th death
        if self.death_count >= 10 and not self.prank_launched:
            prank = find_prank_exe()
            if prank:
                try:
                    subprocess.Popen([prank])
                    self.prank_launched = True
                except Exception:
                    pass

    # ── Draw ──────────────────────────────────────────────────────────────

    def draw(self):
        self.screen.fill(DARK_NAVY)

        for sx, sy in STAR_POS:
            pygame.draw.circle(self.screen, STAR_COLOR, (sx, sy), 1)

        for pipe in self.pipes:
            pipe.draw(self.screen)

        # Gap image — only draw if not yet collected by player
        if self.gap_img.get_width() > 0:
            gw = self.gap_img.get_width()
            gh = self.gap_img.get_height()
            for pipe in self.pipes:
                if not pipe.collected:
                    gap_cx = int(pipe.x) + PIPE_WIDTH // 2
                    gap_cy = (pipe.top_h + pipe.bot_y) // 2
                    self.screen.blit(self.gap_img, (gap_cx - gw // 2, gap_cy - gh // 2))

        self.bird.draw(self.screen)

        # Score — top right
        sc = self.font_score.render(str(self.score), True, WHITE)
        self.screen.blit(sc, (W - sc.get_width() - 15, 12))

        # Death counter — top left
        dc = self.font_small.render(f"Deaths: {self.death_count}/10", True, GRAY)
        self.screen.blit(dc, (10, 14))

        if self.waiting:
            self._draw_start_screen()
        elif not self.alive:
            self._draw_game_over()

        pygame.display.flip()

    def _draw_start_screen(self):
        # Soft overlay
        ov = pygame.Surface((W, H), pygame.SRCALPHA)
        ov.fill((0, 0, 0, 90))
        self.screen.blit(ov, (0, 0))

        # Title
        title = self.font_huge.render("Bobby Bird", True, YELLOW)
        self.screen.blit(title, (W // 2 - title.get_width() // 2, H // 4 - 30))

        # Bird hovering in the center (sine oscillation)
        hover_y = H // 2 - Bird.SIZE // 2 + int(math.sin(time.time() * 3) * 12)
        img = pygame.transform.smoothscale(self.player_img, (Bird.SIZE, Bird.SIZE))
        self.screen.blit(img, (W // 2 - Bird.SIZE // 2, hover_y))

        # "Press Space" — blinks every 0.6 s
        if int(time.time() * 1.7) % 2 == 0:
            prompt = self.font_big.render("Press SPACE to start", True, WHITE)
            self.screen.blit(prompt, (W // 2 - prompt.get_width() // 2, H * 2 // 3))

    def _draw_game_over(self):
        # Semi-transparent overlay
        ov = pygame.Surface((W, H), pygame.SRCALPHA)
        ov.fill((0, 0, 0, 140))
        self.screen.blit(ov, (0, 0))

        # GAME OVER
        go = self.font_huge.render("GAME OVER", True, RED)
        self.screen.blit(go, (W // 2 - go.get_width() // 2, H // 2 - 90))

        # Score
        sc = self.font_big.render(f"Score: {self.score}", True, YELLOW)
        self.screen.blit(sc, (W // 2 - sc.get_width() // 2, H // 2 - 20))

        # Before 10th death: always show restart hint (no prank yet)
        # On 10th death: only show hint if prank.exe not found
        if self.death_count < 10 or not find_prank_exe():
            hint = self.font_small.render("Press R to restart", True, WHITE)
            self.screen.blit(hint,
                             (W // 2 - hint.get_width() // 2, H // 2 + 30))

        # Countdown
        if self.game_over_t:
            remaining = max(0.0, 3.0 - (time.time() - self.game_over_t))
            cnt = self.font_small.render(
                f"Restarting in {remaining:.1f}s  |  R to restart now",
                True, GRAY,
            )
            self.screen.blit(cnt,
                             (W // 2 - cnt.get_width() // 2, H // 2 + 65))

    # ── Main loop ─────────────────────────────────────────────────────────

    def run(self):
        while True:
            self.clock.tick(FPS)
            self.handle_events()
            self.update()
            self.draw()


# ---------------------------------------------------------------------------

if __name__ == "__main__":
    Game().run()
