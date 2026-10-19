process.env.MYGRAIN_DRUM_FX_WET_ONLY = '1';

require('./drum-parallel-fx-browser.js').runCli().catch(error => {
    console.error(error.stack);
    process.exitCode = 1;
});
