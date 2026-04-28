# Class Compass

Class Compass is a student-first command workspace for the semester.

The product promise is simple: upload your syllabus, review what was extracted, and get a clear plan for what to do next. The app is built as a local-first Vite web app for challenge demos, so it works without requiring auth or a backend.

## What it does

- Upload syllabi and course files from the browser
- Extract course details, deadlines, exams, readings, grading, and policies
- Route extracted data through a review-and-approve flow before it enters the plan
- Generate a Today view with a next best action, queue, and risk signals
- Show a Semester Map timeline for heavy and crunch weeks
- Provide a Course Command Center for assignments, materials, policies, and study actions
- Decode assignment prompts into summaries, checklists, milestones, and questions
- Offer grounded study helpers with source-aware outputs

## Product flow

1. Upload a syllabus or course file
2. Review extracted items and approve what should enter the plan
3. Work from Today, Courses, Calendar, Assignments, and Study

## Tech

- Vite
- Vanilla JavaScript
- Local browser storage for demo persistence
- Optional Supabase schema included under `supabase/`
- Vercel for deployment

## Local development

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
```

The root `index.html` redirects to the built app in `dist/` so direct `file://` previews still work for demoing.

## Demo path

1. Open the app
2. Click `Try sample syllabus` or upload a real syllabus
3. Review the extracted course details
4. Click `Approve and build plan`
5. Explore Today, Courses, Calendar, Assignments, Study, Upload, and Settings

## Deployment

The app is deployed on Vercel. Once the repo is linked, redeploy with:

```bash
vercel deploy --yes --scope alexvaldes64-1610s-projects
```

## Notes

- The app is designed to help students organize, understand, and study.
- It does not generate final assignment submissions.
- Challenge-demo persistence is local-first and stored in the browser on the current device.
