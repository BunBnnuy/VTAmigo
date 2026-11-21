// Random lines for the lab's dice button. Grouped by the act the classifier
// should produce, so a few clicks exercise every gesture and expression
// instead of landing on "neutral" ten times.

const LINES = {
  greeting: [
    "¡Hola! ¿Cómo estás hoy?",
    "¡Buenas! Bienvenido al stream.",
    "Hey, me alegro de verte por aquí.",
    "¡Hola, hola! ¿Qué tal la mañana?",
    "Saludos, ¿lista para lo que venga?",
  ],
  question: [
    "¿Qué te parece si probamos algo nuevo?",
    "¿Alguien sabe a qué hora empieza la partida?",
    "¿Cuál es tu juego favorito de este año?",
    "¿Por qué no lo intentamos otra vez?",
    "¿Cómo se llama esa canción que sonaba antes?",
  ],
  thinking: [
    "Mmm, déjame pensar un momento…",
    "Quizá la respuesta sea más simple de lo que parece.",
    "Creo que ya sé por dónde va esto.",
    "Supongo que tendremos que probarlo.",
    "Tal vez mañana salga mejor.",
  ],
  happy: [
    "¡Qué genial! Esto ha salido perfecto.",
    "¡Jaja! No me esperaba esa.",
    "Increíble, vamos a por otra ronda.",
    "¡Me encanta cómo ha quedado!",
    "¡Bravo! Eso ha sido épico.",
  ],
  surprised: [
    "¡No me lo puedo creer!",
    "En serio, ¡qué sorpresa!",
    "¡Vaya! Eso no me lo esperaba.",
    "¡Un momento! Eso acaba de pasar.",
    "¡Increíble! No puede ser.",
  ],
  sad: [
    "Lo siento mucho, de verdad.",
    "Qué pena que no haya salido.",
    "Es triste despedirse tan pronto.",
    "Qué triste, otra vez será.",
    "Lo siento, no pasa nada.",
  ],
  angry: [
    "Esto me está empezando a molestar.",
    "¡Basta! Ya vale.",
    "Esto me molesta bastante.",
    "Estoy harto de esperar.",
    "Odio cuando pasa esto.",
  ],
  thanks: [
    "Gracias por todo, en serio.",
    "Te lo agradezco un montón.",
    "Muchas gracias por la ayuda.",
    "Gracias, eres muy amable.",
    "Mil gracias, me has salvado.",
  ],
  neutral: [
    "Vamos a ver esto con calma.",
    "Nos vemos en un rato.",
    "Esto es todo por hoy.",
    "Seguimos en directo.",
    "Voy a contarte una cosa.",
  ],
};

export const RANDOM_ACT_NAMES = Object.keys(LINES);

let lastAct = null;

// Avoids repeating the previous act, so two clicks in a row never test the
// same gesture twice.
export function randomLine() {
  const candidates = RANDOM_ACT_NAMES.filter((act) => act !== lastAct);
  const act = candidates[Math.floor(Math.random() * candidates.length)];
  lastAct = act;
  const pool = LINES[act];
  return pool[Math.floor(Math.random() * pool.length)];
}
