/* Delegated so lazily mounted loop/K/Q controls receive the same gesture. */
(function () {
    'use strict';
    const presses = new Map(), taps = new WeakMap();
    function panSlider(target) {
        if (!(target instanceof HTMLInputElement) || target.type !== 'range'
            || target.disabled || !(Number(target.min) < 0 && Number(target.max) > 0)) return null;
        return /pan/i.test(target.id + ' ' + Object.values(target.dataset).join(' '))
            || target.hasAttribute('data-k-pan') ? target : null;
    }
    function centre(slider, event) {
        if (event.cancelable) event.preventDefault();
        taps.delete(slider);
        slider.value = '0';
        // Use each control's authoritative audio/UI/history/persistence handlers.
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        slider.dispatchEvent(new Event('change', { bubbles: true }));
    }
    document.addEventListener('pointerdown', event => {
        const slider = panSlider(event.target);
        if (!slider || !event.isPrimary || event.button !== 0) return;
        presses.set(event.pointerId, { slider, x: event.clientX, y: event.clientY, at: performance.now(), moved: false });
    }, true);
    document.addEventListener('pointermove', event => {
        const press = presses.get(event.pointerId);
        if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8) press.moved = true;
    }, true);
    document.addEventListener('pointercancel', event => {
        const press = presses.get(event.pointerId);
        if (press) taps.delete(press.slider);
        presses.delete(event.pointerId);
    }, true);
    document.addEventListener('pointerup', event => {
        const press = presses.get(event.pointerId);
        presses.delete(event.pointerId);
        if (!press) return;
        const now = performance.now();
        if (press.moved || now - press.at > 350 || Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8) {
            taps.delete(press.slider); return;
        }
        const previous = taps.get(press.slider);
        if (previous && now - previous.at <= 350 && previous.type === event.pointerType
            && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <= 32) centre(press.slider, event);
        else taps.set(press.slider, { at: now, x: event.clientX, y: event.clientY, type: event.pointerType });
    }, true);
    document.addEventListener('dblclick', event => {
        const slider = panSlider(event.target);
        if (slider) centre(slider, event);
    }, true);
})();
