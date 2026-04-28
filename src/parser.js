import { excerpt, inferPriority, isoDay, normalizeWhitespace, parsePercent, slugify, uid } from "./utils.js";

const MONTHS =
  "january february march april may june july august september october november december".split(" ");

function parseDateCandidate(raw) {
  if (!raw) return "";
  const compact = String(raw).replace(/[.,]/g, "").trim();
  const numeric = compact.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (numeric) {
    const month = Number(numeric[1]);
    const day = Number(numeric[2]);
    const year = Number(numeric[3] || new Date().getFullYear());
    return isoDay(new Date(year < 100 ? 2000 + year : year, month - 1, day));
  }

  const spelled = compact.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?/i
  );
  if (spelled) {
    const month = MONTHS.indexOf(spelled[1].toLowerCase());
    const day = Number(spelled[2]);
    const year = Number(spelled[3] || new Date().getFullYear());
    return isoDay(new Date(year, month, day));
  }

  return "";
}

function pdfTextFragments(source) {
  const literalMatches = [...source.matchAll(/\(([^()]*(?:\\.[^()]*)*)\)/g)].map((match) =>
    match[1]
      .replace(/\\\)/g, ")")
      .replace(/\\\(/g, "(")
      .replace(/\\n/g, " ")
      .replace(/\\r/g, " ")
      .replace(/\\t/g, " ")
  );

  return literalMatches.map((fragment) => normalizeWhitespace(fragment)).filter((fragment) => fragment.length > 4);
}

async function extractText(file) {
  if (file.type.startsWith("text/") || /\.(txt|md|csv)$/i.test(file.name)) {
    return { text: await file.text(), status: "parsed", warnings: [] };
  }

  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
    const arrayBuffer = await file.arrayBuffer();
    const source = new TextDecoder("latin1").decode(arrayBuffer);
    const text = normalizeWhitespace(pdfTextFragments(source).join(" "));
    if (text.length < 80) {
      return {
        text: "",
        status: "needs-review",
        warnings: ["This PDF appears to be scanned or image-based. Manual review is required."],
      };
    }
    return { text, status: "parsed", warnings: [] };
  }

  return {
    text: "",
    status: "blocked",
    warnings: ["This file type is stored, but in-browser extraction is not supported."],
  };
}

function extractSnippets(text) {
  return text
    .split(/\n+/)
    .map((line) => normalizeWhitespace(line))
    .filter((line) => line.length > 24)
    .slice(0, 8);
}

function courseCode(text, fileName) {
  return (
    text.match(/\b[A-Z]{2,4}\s?\d{3}[A-Z]?\b/)?.[0] ||
    fileName.toUpperCase().match(/\b[A-Z]{2,4}\s?\d{3}[A-Z]?\b/)?.[0] ||
    ""
  );
}

function courseTitle(text, fileName, code) {
  const title =
    text.match(/(?:Course Title|Class Title|Title)\s*:\s*(.+)/i)?.[1] ||
    text.match(/^\s*[A-Z]{2,4}\s?\d{3}[A-Z]?\s+(.+)$/m)?.[1] ||
    "";
  if (title) return normalizeWhitespace(title);
  return normalizeWhitespace(
    fileName.replace(/\.[^.]+$/, "").replace(code, "").replace(/syllabus|notes|slides|rubric|prompt/gi, "")
  );
}

function classifyLine(line) {
  if (isLogisticsLine(line)) return "";
  if (/(midterm|final|exam|quiz|test)/i.test(line)) return "exam";
  if (/(read|reading|chapter|article|pages?)/i.test(line)) return "reading";
  if (/(assignment|paper|essay|project|brief|lab|discussion|reflection|homework|problem set)/i.test(line)) {
    return "assignment";
  }
  return "";
}

function isLogisticsLine(line) {
  return /^(course title|class title|title|instructor|professor|faculty|office hours?|required materials?|late policy|attendance policy|grading|schedule)\s*:/i.test(line);
}

function extractWeights(text) {
  return text
    .split(/\n+/)
    .map((line) => normalizeWhitespace(line))
    .filter((line) => /%/.test(line))
    .map((line) => {
      const weight = parsePercent(line);
      const label = normalizeWhitespace(line.replace(/\(?\d{1,3}(?:\.\d+)?%\)?/g, ""));
      if (!weight || !label) return null;
      return { id: uid("weight"), label, weight };
    })
    .filter(Boolean)
    .slice(0, 8);
}

function buildRows(text, sourceDocumentId) {
  const assignments = [];
  const exams = [];
  const readings = [];
  const lines = text
    .split(/\n+/)
    .map((line) => normalizeWhitespace(line))
    .filter((line) => line.length > 8);

  lines.forEach((line) => {
    const type = classifyLine(line);
    if (!type) return;
    const parsedDate = parseDateCandidate(line);
    if (!parsedDate && (type === "assignment" || type === "exam")) return;
    const weight = parsePercent(line);
    const cleanedTitle = normalizeWhitespace(
      line
        .replace(/(?:due|on|by)\s+.+$/i, "")
        .replace(/\(?\d{1,3}(?:\.\d+)?%\)?/g, "")
        .replace(/^week\s+\d+[:\-]?\s*/i, "")
    );

    if (type === "assignment") {
      assignments.push({
        id: uid("draft-assignment"),
        title: cleanedTitle || "Assignment",
        due_date: parsedDate,
        weight: weight || 0,
        estimated_minutes: weight >= 20 ? 180 : 90,
        priority: inferPriority(parsedDate ? Math.max(0, difference(new Date(parsedDate), new Date())) : 10),
        confidence: parsedDate ? "high" : "medium",
        source_excerpt: line,
        source_document_ids: [sourceDocumentId],
        deleted: false,
      });
    } else if (type === "exam") {
      exams.push({
        id: uid("draft-exam"),
        title: cleanedTitle || "Exam",
        exam_date: parsedDate,
        weight: weight || 0,
        confidence: parsedDate ? "high" : "medium",
        source_excerpt: line,
        source_document_ids: [sourceDocumentId],
        deleted: false,
      });
    } else if (type === "reading") {
      readings.push({
        id: uid("draft-reading"),
        title: cleanedTitle || "Reading",
        due_date: parsedDate,
        pages: line.match(/\bpages?\s+([\d\-to ]+)/i)?.[1] || "",
        confidence: parsedDate ? "high" : "medium",
        source_excerpt: line,
        source_document_ids: [sourceDocumentId],
        deleted: false,
      });
    }
  });

  return { assignments, exams, readings };
}

function difference(a, b) {
  return Math.round((a - b) / 86400000);
}

export async function parseCourseFiles(files) {
  const documents = [];
  const drafts = [];

  for (const file of files) {
    const extraction = await extractText(file);
    const documentId = uid("doc");
    const text = extraction.text;
    const code = courseCode(text, file.name);
    const title = courseTitle(text, file.name, code);
    const rows = buildRows(text, documentId);
    const warnings = [...extraction.warnings];
    if (!code) warnings.push("Course code could not be confidently extracted.");

    documents.push({
      id: documentId,
      file,
      file_name: file.name,
      mime_type: file.type,
      kind: inferKind(file.name),
      source_type: /\.pdf$/i.test(file.name) ? "pdf" : "text",
      extraction_status: extraction.status,
      warnings,
      extracted_text: text,
      snippets: extractSnippets(text),
      preview: excerpt(text),
      course_key: slugify(code || title || file.name),
      course_draft: {
        code,
        title: title || "Untitled Course",
        professor: text.match(/(?:Instructor|Professor|Faculty)\s*:\s*(.+)/i)?.[1] || "",
        office_hours: text.match(/Office Hours?\s*:\s*(.+)/i)?.[1] || "",
        grading_weights: extractWeights(text),
        policies: {
          late_policy: text.match(/late policy[:\s]+(.+)/i)?.[1] || "",
          attendance_policy: text.match(/attendance policy[:\s]+(.+)/i)?.[1] || "",
          required_materials: text.match(/required materials?[:\s]+(.+)/i)?.[1] || "",
        },
      },
      rows,
    });
  }

  const grouped = new Map();
  documents.forEach((document) => {
    const existing = grouped.get(document.course_key);
    if (!existing) {
      grouped.set(document.course_key, {
        id: uid("draft-import"),
        course_key: document.course_key,
        course_draft: document.course_draft,
        document_ids: [document.id],
        warnings: [...document.warnings],
        assignments: [...document.rows.assignments],
        exams: [...document.rows.exams],
        readings: [...document.rows.readings],
        status: "draft",
      });
      return;
    }
    existing.document_ids.push(document.id);
    existing.warnings = [...new Set([...existing.warnings, ...document.warnings])];
    existing.assignments.push(...document.rows.assignments);
    existing.exams.push(...document.rows.exams);
    existing.readings.push(...document.rows.readings);
  });

  drafts.push(...grouped.values());
  return { documents, drafts };
}

function inferKind(fileName) {
  if (/rubric/i.test(fileName)) return "rubric";
  if (/prompt/i.test(fileName)) return "prompt";
  if (/(slides?|deck|powerpoint|pptx?)/i.test(fileName)) return "slides";
  if (/(notes?|lecture)/i.test(fileName)) return "notes";
  if (/(reading|article|chapter)/i.test(fileName)) return "reading";
  if (/(review|study guide|exam prep)/i.test(fileName)) return "review";
  if (/transcript/i.test(fileName)) return "transcript";
  return "syllabus";
}
