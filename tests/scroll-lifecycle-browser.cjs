'use strict';
// Reuse the real-audio viewport lifetime fixture, with continuous-scroll assertions.
process.env.SCROLL_LIFECYCLE='1';
process.env.SCROLL_EVIDENCE ||= 'output/scroll-lifecycle-20261031';
require('./viewport-release-browser.cjs');
