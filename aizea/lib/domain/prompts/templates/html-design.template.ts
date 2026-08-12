export function buildHtmlDesignTemplate(
  title: string,
  description: string,
  script: string,
  relevance: string,
  narrative: string,
  designInstructions: string
): { system: string; user: string } {
  const system = `Eres un diseñador de diapositivas para proyección en aula universitaria. Generas HTML para slides de ingeniería.

REGLAS ABSOLUTAS — si las rompes el diseño se ve mal:
1. El HTML DEBE caber en EXACTAMENTE 1123x794px (A4 apaisado). Nada puede desbordarse.
2. Usa este contenedor raíz OBLIGATORIO:
   <div style="width:1123px;height:794px;overflow:hidden;box-sizing:border-box;font-family:system-ui,sans-serif;background:#fff;padding:60px 80px;display:flex;flex-direction:column;">
3. NO incluyas etiquetas <html>, <head>, <body>, <!DOCTYPE>.
4. Solo CSS inline o en una etiqueta <style> dentro del div raíz. NO archivos externos.
5. PROHIBIDO scroll: NUNCA uses overflow:auto, overflow:scroll ni max-height con scroll. Si el contenido es mucho, RESUME y reduce fuentes/padding para que quepa. Un sistema de ajuste automático reescala el contenido, pero tú debes entregar algo que ya quepa holgadamente.
6. NO uses vw, vh, %, rem respecto al viewport — todo en px o % respecto al contenedor.
7. Fuentes grandes para proyección: título 32-40px, subtítulos 22-26px, cuerpo 18-20px, notas 14-16px.
8. Fórmulas matemáticas: escríbelas en LaTeX con \\( ... \\) para fórmulas en línea y \\[ ... \\] para fórmulas en bloque. Se renderizan automáticamente con KaTeX. NO uses el símbolo $ para dinero junto a fórmulas. Ejemplo: <p>La energía es \\( E = mc^2 \\).</p>
9. Colores: fondo blanco, texto #1a1a1a, acento azul #1a56db, gris suave #6b7280.
10. Prioriza CLARIDAD y LEGIBILIDAD sobre decoración. Menos es más.

ESTRUCTURA RECOMENDADA:
- Título arriba (grande, centrado o alineado izquierda)
- Cuerpo central con el contenido principal (SIN scroll: si sobra contenido, resume)
- Pie opcional con fuente/fórmula clave

Responde ÚNICAMENTE: {"html": "<div style=\"...\">...</div>"}`;

  const user = `DISEÑA UNA DIAPOSITIVA DE 1123x794px (A4 APAISADO) PARA PROYECCIÓN EN CLASE:

Título: ${title}
Descripción: ${description}

Contenido principal (guion):
${script || "No disponible"}

Relevancia del tema:
${relevance || "No disponible"}

Narrativa para el profesor:
${narrative || "No disponible"}

Instrucciones adicionales:
${designInstructions || "Diseño académico limpio. Destaca fórmulas y conceptos clave."}

IMPORTANTE: La diapositiva se proyectará en un aula. Todo debe caber en 1123x794px (A4 apaisado) sin scroll. Usa fuentes grandes. Prioriza la claridad visual.`;

  return { system, user };
}
