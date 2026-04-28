import { excerpt, formatDate, normalizeWhitespace, uid } from "./utils.js";

export function decodeAssignment({ prompt, dueDate, course, documents }) {
  const cleaned = normalizeWhitespace(prompt);
  const context = (documents || [])
    .filter((document) => !course || document.course_id === course.id)
    .flatMap((document) => document.snippets || [])
    .slice(0, 3);

  return {
    id: uid("decoder"),
    course_id: course?.id || null,
    due_date: dueDate,
    prompt: cleaned,
    summary: cleaned.length > 220 ? `${cleaned.slice(0, 217)}...` : cleaned,
    checklist: [
      "Identify the deliverable, required format, and source expectations.",
      "Mark what will be graded most heavily from the prompt or rubric.",
      "List the sources, notes, or lecture materials you need before drafting.",
      "Write down the questions you should ask before starting.",
    ],
    hiddenRequirements: [
      "Check whether the prompt implies a required citation style, source count, or formatting rule.",
      "Look for verbs such as compare, analyze, defend, reflect, or synthesize; those signal how the work will be judged.",
      "Confirm whether drafts, peer review, examples, or process notes count toward the grade.",
    ],
    milestones: [
      "Translate the assignment into plain language before doing any drafting.",
      `Gather sources and notes before ${formatDate(dueDate)}.`,
      "Build an outline or evidence table before writing.",
      "Review against the rubric before submission.",
    ],
    questions: [
      "What exactly is the final deliverable?",
      "What counts most in the grading criteria?",
      "Which source or policy should be double-checked first?",
    ],
    pointRisks: [
      "Missing the required format or citation style.",
      "Answering the topic generally instead of the exact prompt.",
      "Skipping a rubric category that carries visible points.",
      "Submitting without checking the professor's instructions against the final draft.",
    ],
    citations: context.map((snippet) => ({
      source_file: course?.code || "Course material",
      source_section: "Related material",
      excerpt: snippet,
    })),
    context,
  };
}

export function answerGroundedQuestion({ question, documents, assignments, selectedCourseId }) {
  const lower = question.toLowerCase();
  if (/(write|complete|do my|final essay|final submission|submit this for me)/i.test(lower)) {
    return {
      message: "I can help you understand, plan, quiz, and check your work, but I will not generate a final submission.",
      citations: [],
      confidence: "high",
    };
  }

  const scopedDocuments = documents.filter((document) => !selectedCourseId || document.course_id === selectedCourseId);
  const tokens = lower.split(/\W+/).filter((token) => token.length > 3);
  const matches = scopedDocuments
    .map((document) => {
      const corpus = [document.extracted_text || "", ...(document.snippets || [])].join(" ");
      const score = tokens.reduce((total, token) => total + (corpus.toLowerCase().includes(token) ? 1 : 0), 0);
      return {
        document,
        score,
        excerpt: document.snippets?.find((snippet) => tokens.some((token) => snippet.toLowerCase().includes(token))) || excerpt(document.extracted_text || ""),
      };
    })
    .filter((item) => item.score > 0 && item.excerpt)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (/what should i do first|what should i work on next|help me organize/.test(lower)) {
    const nearest = assignments
      .filter((assignment) => !selectedCourseId || assignment.course_id === selectedCourseId)
      .filter((assignment) => assignment.due_date)
      .sort((a, b) => new Date(a.due_date) - new Date(b.due_date))
      .slice(0, 3);
    return {
      message:
        nearest.length > 0
          ? `Start with ${nearest.map((item) => `${item.title} due ${formatDate(item.due_date)}`).join(", ")}. Break the first item into a short prep block before you draft or submit anything.`
          : "No confirmed assignments are available yet. Upload a syllabus or confirm a draft import first.",
      citations: matches.map((item) => ({
        source_file: item.document.file_name,
        source_section: "document snippet",
        excerpt: item.excerpt,
      })),
      confidence: matches.length ? "medium" : "low",
    };
  }

  if (!matches.length) {
    return {
      message: "I could not find that in your uploaded materials. Try asking about a specific assignment, concept, policy, or due date.",
      citations: [],
      confidence: "low",
      notFound: true,
    };
  }

  return {
    message: `Grounded answer: ${matches.map((item) => item.excerpt).join(" ")}`,
    citations: matches.map((item) => ({
      source_file: item.document.file_name,
      source_section: "document snippet",
      excerpt: item.excerpt,
    })),
    confidence: matches[0].score >= 2 ? "high" : "medium",
  };
}

export function generateQuiz({ course, documents }) {
  const snippets = academicSourceItems(documents, course)
    .slice(0, 5);
  return snippets.map((snippet, index) => ({
    id: uid("quiz"),
    question: `Question ${index + 1}: Explain this in your own words.`,
    prompt: snippet,
  }));
}

export function buildStudyGuide({ course, documents }) {
  const academicItems = academicSourceItems(documents, course, true).slice(0, 6);

  if (!academicItems.length) {
    return {
      title: documents?.length ? "Syllabus planning mode" : "No source material yet",
      hasAcademicContent: false,
      sections: {
        keyTopics: documents?.length
          ? "You have course logistics and deadlines, but not enough academic content for a real study guide."
          : "Upload notes, slides, or a review sheet to build a grounded study guide.",
        whatToKnow: "",
        practice: "",
        weakSpots: "",
      },
      citations: [],
    };
  }

  return {
    title: course ? `${course.code} study guide` : "Study guide",
    hasAcademicContent: true,
    sections: {
      keyTopics: academicItems.slice(0, 3).map((item) => item.snippet).join(" "),
      whatToKnow: "Focus on terms, policies, examples, and review items that appear in multiple uploaded materials. If a concept appears in a syllabus plus notes, study it before lower-context material.",
      practice: academicItems.slice(0, 3).map((item, index) => `Q${index + 1}: Explain ${item.snippet.slice(0, 80)} in your own words.`).join(" "),
      weakSpots: "Flag anything you cannot explain without looking. Turn those flagged items into quiz prompts before the next deadline.",
    },
    citations: academicItems.map((item) => ({
      source_file: item.document.file_name,
      source_section: "Uploaded material",
      excerpt: item.snippet,
    })),
  };
}

export function buildFlashcards({ course, documents }) {
  const snippets = academicSourceItems(documents, course, true)
    .slice(0, 8);

  return snippets.map((item, index) => ({
    id: uid("card"),
    front: `Card ${index + 1}`,
    back: item.snippet,
    citation: {
      source_file: item.document.file_name,
      source_section: "Uploaded material",
      excerpt: item.snippet,
    },
  }));
}

function academicSourceItems(documents = [], course, withDocument = false) {
  const logisticPattern = /(course title|instructor|professor|office hours|late policy|attendance policy|required materials|grading|schedule|percent|%|science hall|tuesday|monday|wednesday|thursday|friday|syllabus)/i;
  const academicPattern = /(lecture|chapter|cell|membrane|research|method|data|analysis|concept|theory|definition|example|problem|review|lab result|hypothesis|evidence|reading)/i;
  const items = documents
    .filter((document) => !course || document.course_id === course.id)
    .filter((document) => !/syllabus/i.test(document.kind || ""))
    .flatMap((document) =>
      (document.snippets || [])
        .map((snippet) => normalizeWhitespace(snippet))
        .filter((snippet) => snippet.length > 28 && academicPattern.test(snippet) && !logisticPattern.test(snippet))
        .map((snippet) => (withDocument ? { document, snippet } : snippet))
    );
  return items;
}
