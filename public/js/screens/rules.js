// ═══════════════════════════════════════════
// Rules Screen
// ═══════════════════════════════════════════

import * as state from '../state.js';
import * as bottomNav from '../components/bottom-nav.js';
import * as hostMenu from '../components/host-menu.js';
import { getGame } from '../games/registry.js';

export function mount(container, params = {}) {
  const roomCode = params.roomCode || state.get('roomCode');

  if (!roomCode) {
    router.navigate('home');
    return;
  }

  const topBar = document.getElementById('top-bar');
  topBar.style.display = 'flex';
  document.getElementById('top-bar-title').textContent = 'RULES';
  document.getElementById('top-bar-back').classList.remove('hidden');
  document.getElementById('top-bar-back').onclick = () => router.navigate('lobby', { roomCode });
  hostMenu.hide();
  hostMenu.renderTopBarActions(roomCode);

  bottomNav.show('rules');

  const game = state.currentGame();
  if (!game) {
    container.innerHTML = `<div class="screen-body screen-body--center text-center"><p class="text-on-surface-variant">No active game</p></div>`;
    return;
  }

  const gameModule = getGame(game.type);
  if (!gameModule) return;

  container.innerHTML = `
    <div class="screen-body pb-8">
      <!-- Hero -->
      <section class="border-l-4 border-primary pl-6 mb-12">
        <h2 class="text-4xl font-headline font-black uppercase tracking-tight leading-[0.9] mb-3">${gameModule.label}<br>RULEBOOK</h2>
        <p class="font-mono text-[10px] uppercase tracking-[0.2em] text-outline">QUICK REFERENCE / V1</p>
      </section>

      <!-- Rules Content -->
      <div class="rules-content space-y-10">
        ${gameModule.rulesHTML}
      </div>
    </div>
  `;
}

export function unmount() {}
