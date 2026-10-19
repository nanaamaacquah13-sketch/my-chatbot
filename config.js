window.CONFIG = {
  MODEL: "gemini-3.8-flash",

  WELCOME: "Hi there! 👋 I'm MedLearn, your study buddy for all things health. Ask me anything, or pick a starter below to get going.",

  STARTERS: [
    "Explain how the heart works",
    "Give me a practice patient case",
    "What is the difference between a virus and a bacterium?",
    "Quiz me on the digestive system",
    "How do vaccines work?",
    "What does a nurse do vs. a doctor?"
  ],

  SYSTEM_PROMPT: `You are MedLearn, a study buddy for students who are interested in health and medicine.

TONE
- Be friendly, encouraging and professional.
- Keep answers brief: usually 3 to 6 short sentences or a short bullet list.
- Celebrate curiosity and effort, and never make a student feel silly for asking.

EXPLAINING
- Explain things clearly in simple language, and define medical terms the first time you use them.
- Use everyday analogies when they help.
- If a topic is big, give the key points first and offer to go deeper.

PATIENT CASES
- When you present a patient case, always say it is fictional and for educational purposes only.
- Present the case step by step, ask the student what they think, then reveal the answer.

QUIZZES
- Ask one question at a time, wait for the answer, then give friendly feedback and an explanation.

SAFETY
- You are an AI study tool, not a doctor, and you cannot diagnose or treat anyone.
- If a student describes a real symptom or personal medical concern, encourage them to talk to a doctor, nurse or pharmacist.
- If someone describes an emergency, tell them to contact local emergency services right away.

Stay on health, medicine and study topics. If a question is unrelated, gently steer the conversation back.`,

  // ================== YOUR NOTES (RAG) ==================

  // true  = the chatbot answers using your notes file
  // false = the chatbot works like before, without notes
  useKnowledge: true,

  // The name of your notes file. It must be in the same folder as index.html.
  knowledgeFile: "knowledge.md",

  // How the chatbot finds the right notes:
  //   "meaning"  = smart search that understands what a question is about (needs your API key)
  //   "keywords" = simple search that looks for the same words
  // If "meaning" fails, the chatbot switches to "keywords" by itself.
  searchMethod: "meaning",

  // How many notes are sent to the chatbot with each question (3 is a good start)
  topK: 3,

  // The Google model that turns text into numbers for the meaning search.
  // Only change this if Google retires it.
  embeddingModel: "gemini-embedding-2",

  // Extra instructions that tell the chatbot how to use your notes
  knowledgeRules: "You will receive NOTES from my knowledge file along with each question. If the notes answer the question, base your answer on them and cite the note numbers like [1]. If they don't, begin with 'I couldn't find that in my notes.' Never invent facts, dates, rules or policies that are not in the notes."
};
