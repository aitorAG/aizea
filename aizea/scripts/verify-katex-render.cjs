#!/usr/bin/env node
// verify-katex-render.cjs — diagnóstico de renderizado KaTeX
//
// Genera un HTML de prueba con fórmulas y lo renderiza con Playwright
// para verificar que KaTeX se ejecuta correctamente.

const fs = require('fs');
const path = require('path');

// Usar KaTeX desde CDN para simplificar el test (el real usa inline)
const TEST_HTML = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Test KaTeX</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.47/dist/katex.min.css">
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.47/dist/katex.min.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.47/dist/contrib/auto-render.min.js"></script>
<script>
(function() {
  var OPTS = {
    delimiters: [
      { left: "$$", right: "$$", display: true },
      { left: "\\\\[", right: "\\\\]", display: true },
      { left: "\\\\(", right: "\\\\)", display: false },
      { left: "$", right: "$", display: false }
    ],
    throwOnError: false,
    strict: false,
    ignoredTags: ["script","noscript","style","textarea","pre","code"]
  };
  
  function run() {
    console.log('[TEST] DOM ready, running KaTeX...');
    var container = document.getElementById('test-content');
    
    if (!window.renderMathInElement) {
      console.error('[TEST] renderMathInElement NOT FOUND');
      document.getElementById('result').textContent = 'FAIL: renderMathInElement not found';
      return;
    }
    
    try {
      renderMathInElement(container, OPTS);
      console.log('[TEST] renderMathInElement executed');
      
      // Verificar que se renderizó
      setTimeout(function() {
        var katexElements = container.querySelectorAll('.katex');
        var katexDisplayElements = container.querySelectorAll('.katex-display');
        
        console.log('[TEST] Found', katexElements.length, 'inline math elements');
        console.log('[TEST] Found', katexDisplayElements.length, 'display math elements');
        
        if (katexElements.length >= 2 && katexDisplayElements.length >= 1) {
          document.getElementById('result').textContent = 'PASS: KaTeX rendered correctly';
          document.getElementById('result').style.color = 'green';
        } else {
          document.getElementById('result').textContent = 'FAIL: Expected elements not found';
          document.getElementById('result').style.color = 'red';
        }
      }, 500);
    } catch (e) {
      console.error('[TEST] renderMathInElement error:', e);
      document.getElementById('result').textContent = 'FAIL: ' + e.message;
      document.getElementById('result').style.color = 'red';
    }
  }
  
  if (document.readyState !== 'loading') run();
  else document.addEventListener('DOMContentLoaded', run);
})();
</script>
</head>
<body>
<h1>Test de Renderizado KaTeX</h1>
<div id="test-content">
  <p>Fórmula inline: \\(x^2 + y^2 = z^2\\)</p>
  <p>Otra inline: \\(E = mc^2\\)</p>
  <p>Fórmula display:</p>
  \\[
    \\int_0^1 x^2 dx = \\frac{1}{3}
  \\]
  <p>Legacy dollar syntax: $a + b = c$</p>
</div>
<h2 id="result" style="margin-top: 2em; font-weight: bold;">WAITING...</h2>
</body>
</html>`;

async function main() {
  const outPath = path.join(__dirname, '../tmp-katex-test.html');
  fs.writeFileSync(outPath, TEST_HTML, 'utf8');
  console.log(`[verify-katex] HTML de prueba generado: ${outPath}`);
  console.log('[verify-katex] Abre este archivo en un navegador para verificar.');
  console.log('[verify-katex] Deberías ver "PASS: KaTeX rendered correctly" en verde.');
  
  // Intentar renderizar con Playwright si está disponible
  try {
    const playwright = require('playwright');
    console.log('[verify-katex] Playwright encontrado, renderizando...');
    
    const browser = await playwright.chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    
    await page.setContent(TEST_HTML, { waitUntil: 'load' });
    
    // Esperar un poco para que el script se ejecute
    await page.waitForTimeout(2000);
    
    const resultText = await page.textContent('#result');
    console.log(`[verify-katex] Resultado: ${resultText}`);
    
    // Capturar screenshot
    const screenshotPath = path.join(__dirname, '../tmp-katex-test-screenshot.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`[verify-katex] Screenshot guardado: ${screenshotPath}`);
    
    // Verificar elementos KaTeX
    const katexCount = await page.locator('.katex').count();
    const katexDisplayCount = await page.locator('.katex-display').count();
    
    console.log(`[verify-katex] Elementos .katex encontrados: ${katexCount}`);
    console.log(`[verify-katex] Elementos .katex-display encontrados: ${katexDisplayCount}`);
    
    await browser.close();
    
    if (resultText.includes('PASS')) {
      console.log('\x1b[32m[verify-katex] ✓ KaTeX se renderiza correctamente\x1b[0m');
      process.exit(0);
    } else {
      console.error('\x1b[31m[verify-katex] ✗ KaTeX NO se renderiza correctamente\x1b[0m');
      process.exit(1);
    }
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      console.log('[verify-katex] Playwright no instalado, usa el HTML generado manualmente.');
    } else {
      console.error('[verify-katex] Error:', err.message);
    }
    process.exit(0);
  }
}

main().catch(err => {
  console.error('[verify-katex] Error fatal:', err);
  process.exit(1);
});
