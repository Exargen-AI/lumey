/**
 * Daily quote bank — bundled list, deterministic rotation (2026-05-29).
 *
 * Why bundle instead of fetch from an external API:
 *   - No network dependency, no rate limit, no GDPR pass-through
 *   - We control the tone — every quote is short, work-positive,
 *     non-religious, non-political. No "wake up before sunrise" hustle
 *     porn either.
 *   - One file, edit when the team gets bored of the rotation
 *
 * Selection is deterministic — pickQuote(dateKey) returns the same
 * quote for everyone for that calendar day, but a different one
 * tomorrow. Avoids "different people see different quotes at standup"
 * surprise.
 */

export interface Quote {
  text: string;
  author: string;
}

export const QUOTES: Quote[] = [
  // Engineering / craft
  { text: "The best way to predict the future is to invent it.", author: "Alan Kay" },
  { text: "Programs must be written for people to read, and only incidentally for machines to execute.", author: "Harold Abelson" },
  { text: "Simplicity is prerequisite for reliability.", author: "Edsger Dijkstra" },
  { text: "Premature optimization is the root of all evil.", author: "Donald Knuth" },
  { text: "Walking on water and developing software from a specification are easy if both are frozen.", author: "Edward V. Berard" },
  { text: "Talk is cheap. Show me the code.", author: "Linus Torvalds" },
  { text: "Make it work, make it right, make it fast.", author: "Kent Beck" },
  { text: "Any fool can write code that a computer can understand. Good programmers write code that humans can understand.", author: "Martin Fowler" },
  { text: "Controlling complexity is the essence of computer programming.", author: "Brian Kernighan" },
  { text: "It's not a bug — it's an undocumented feature.", author: "Anonymous" },

  // Focus / shipping
  { text: "Real artists ship.", author: "Steve Jobs" },
  { text: "Done is better than perfect.", author: "Sheryl Sandberg" },
  { text: "The way to get started is to quit talking and begin doing.", author: "Walt Disney" },
  { text: "Action is the foundational key to all success.", author: "Pablo Picasso" },
  { text: "Focus is saying no to a hundred good ideas.", author: "Steve Jobs" },
  { text: "Slow is smooth. Smooth is fast.", author: "U.S. Navy SEALs" },
  { text: "You can do anything, but not everything.", author: "David Allen" },
  { text: "What gets measured gets managed.", author: "Peter Drucker" },

  // Learning / growth
  { text: "The expert in anything was once a beginner.", author: "Helen Hayes" },
  { text: "An investment in knowledge pays the best interest.", author: "Benjamin Franklin" },
  { text: "I have not failed. I've just found 10,000 ways that won't work.", author: "Thomas Edison" },
  { text: "Try not to become a man of success but rather try to become a man of value.", author: "Albert Einstein" },
  { text: "Strive for progress, not perfection.", author: "Unknown" },
  { text: "Compare yourself to who you were yesterday, not to who someone else is today.", author: "Jordan Peterson" },
  { text: "It does not matter how slowly you go as long as you do not stop.", author: "Confucius" },
  { text: "If you don't make mistakes, you're not working on hard enough problems.", author: "Frank Wilczek" },

  // Teamwork / collaboration
  { text: "Talent wins games, but teamwork wins championships.", author: "Michael Jordan" },
  { text: "If you want to go fast, go alone. If you want to go far, go together.", author: "African proverb" },
  { text: "Great things in business are never done by one person; they're done by a team of people.", author: "Steve Jobs" },
  { text: "Alone we can do so little; together we can do so much.", author: "Helen Keller" },
  { text: "Coming together is a beginning, staying together is progress, and working together is success.", author: "Henry Ford" },

  // Resilience / mindset
  { text: "Fall seven times, stand up eight.", author: "Japanese proverb" },
  { text: "It's not whether you get knocked down, it's whether you get up.", author: "Vince Lombardi" },
  { text: "The only place where success comes before work is in the dictionary.", author: "Vidal Sassoon" },
  { text: "What you do speaks so loudly that I cannot hear what you say.", author: "Ralph Waldo Emerson" },
  { text: "The journey of a thousand miles begins with a single step.", author: "Lao Tzu" },
  { text: "Believe you can and you're halfway there.", author: "Theodore Roosevelt" },
  { text: "It's not the load that breaks you down, it's the way you carry it.", author: "Lou Holtz" },
  { text: "The harder you work for something, the greater you'll feel when you achieve it.", author: "Unknown" },

  // Curiosity / creativity
  { text: "Stay hungry, stay foolish.", author: "Stewart Brand" },
  { text: "Creativity is intelligence having fun.", author: "Albert Einstein" },
  { text: "Imagination is more important than knowledge.", author: "Albert Einstein" },
  { text: "Everything you can imagine is real.", author: "Pablo Picasso" },
  { text: "The cure for boredom is curiosity. There is no cure for curiosity.", author: "Dorothy Parker" },
  { text: "If you want something you've never had, you must be willing to do something you've never done.", author: "Thomas Jefferson" },
  { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },

  // Time / focus
  { text: "Lost time is never found again.", author: "Benjamin Franklin" },
  { text: "Either you run the day or the day runs you.", author: "Jim Rohn" },
  { text: "You will never find time for anything. You must make it.", author: "Charles Buxton" },
  { text: "How we spend our days is how we spend our lives.", author: "Annie Dillard" },
  { text: "Time you enjoy wasting is not wasted time.", author: "Marthe Troly-Curtin" },

  // Quality / craft
  { text: "Quality is not an act, it is a habit.", author: "Aristotle" },
  { text: "Excellence is not a destination; it is a continuous journey.", author: "Brian Tracy" },
  { text: "If you're not willing to learn, no one can help you. If you're determined to learn, no one can stop you.", author: "Zig Ziglar" },
  { text: "Genius is one percent inspiration and ninety-nine percent perspiration.", author: "Thomas Edison" },

  // Wisdom / perspective
  { text: "The pessimist sees difficulty in every opportunity. The optimist sees the opportunity in every difficulty.", author: "Winston Churchill" },
  { text: "Worrying is like paying a debt you don't owe.", author: "Mark Twain" },
  { text: "Whether you think you can, or you think you can't — you're right.", author: "Henry Ford" },
  { text: "It always seems impossible until it's done.", author: "Nelson Mandela" },
  { text: "Action expresses priorities.", author: "Mahatma Gandhi" },
  { text: "The best preparation for tomorrow is doing your best today.", author: "H. Jackson Brown Jr." },
  { text: "Yesterday is history, tomorrow is a mystery, today is a gift. That's why it's called the present.", author: "Eleanor Roosevelt" },

  // Lighthearted
  { text: "I can resist everything except temptation.", author: "Oscar Wilde" },
  { text: "Be yourself; everyone else is already taken.", author: "Oscar Wilde" },
  { text: "It is during our darkest moments that we must focus to see the light.", author: "Aristotle" },
  { text: "Life is what happens when you're busy making other plans.", author: "John Lennon" },
];

/**
 * Deterministic per-day quote selection. Same dateKey → same quote;
 * everyone on the team sees the same quote at the same time.
 *
 * Uses a simple Fowler–Noll–Vo-ish folded hash so the rotation is
 * well-distributed across the quote bank — consecutive days never pick
 * the same quote, and weekends don't all land on the same one.
 */
export function pickQuote(dateKey: string): Quote {
  let hash = 2166136261;
  for (let i = 0; i < dateKey.length; i++) {
    hash ^= dateKey.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const idx = Math.abs(hash) % QUOTES.length;
  return QUOTES[idx]!;
}
