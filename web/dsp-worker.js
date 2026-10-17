importScripts('dsp.js');
onmessage = (e) => { const { id, x, sr } = e.data; const y = BirdDSP.clean(x, sr); postMessage({ id, y }, [y.buffer]); };
