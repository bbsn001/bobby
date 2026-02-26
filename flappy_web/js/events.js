// js/events.js
/**
 * Wzorzec "Pub/Sub" (Publish-Subscribe)
 * Służy jako centralny węzeł komunikacyjny. Dzięki niemu engine.js
 * nie musi importować ui.js. Silnik po prostu "krzyczy" w próżnię,
 * a UI nasłuchuje.
 */
class EventBus {
  constructor() {
    this.listeners = {};
  }

  // Zapisz się na zdarzenie (Subskrypcja)
  on(event, callback) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
  }

  // Wypisz się ze zdarzenia
  off(event, callback) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
  }

  // Wyemituj zdarzenie do wszystkich subskrybentów
  emit(event, payload) {
    if (!this.listeners[event]) return;
    this.listeners[event].forEach(cb => cb(payload));
  }
}

export const EventEmitter = new EventBus();
