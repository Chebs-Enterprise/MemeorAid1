import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function capture() {
  const outDir = path.resolve('..', 'report_figures');

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 920 },
    deviceScaleFactor: 2
  });
  const page = await context.newPage();

  // Mock all API endpoints so pages render rich, real senior data!
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (url.includes('/categories')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { id: 1, name: 'Names', icon: 'user', count: 4 },
          { id: 2, name: 'Appointments', icon: 'calendar', count: 3 },
          { id: 3, name: 'Tasks', icon: 'check', count: 5 },
          { id: 4, name: 'Conversations', icon: 'message', count: 2 },
          { id: 5, name: 'Medications', icon: 'pill', count: 4 }
        ])
      });
    }

    if (url.includes('/profile')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: {
            id: 1,
            email: 'margaret.okoro@example.com',
            name: 'Margaret Okoro',
            age_group: '51-65',
            checkin_time: '08:00',
            recall_streak: 5,
            exercise_streak: 3,
            family_email: 'chidi.okoro@care.org'
          }
        })
      });
    }

    if (url.includes('/memories')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 1,
            category: 'Appointments',
            category_name: 'Appointments',
            content: 'Cardiologist review at UNTH Ituku-Ozalla on Thursday at 10:00 AM',
            context_note: 'Dr. Okonkwo requested my blood pressure logbook',
            created_at: '2026-10-25'
          },
          {
            id: 2,
            category: 'Medications',
            category_name: 'Medications',
            content: 'Amlodipine 5mg to be taken every morning after breakfast',
            context_note: 'Keep blister pack in bedside table drawer',
            created_at: '2026-10-24'
          }
        ])
      });
    }

    if (url.includes('/checkin')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          checkin_done: false,
          greeting: 'Good morning, Margaret! It is 8:00 AM. A lovely day to practice your memory recall.',
          motivational_quote: 'Small daily recall exercises strengthen your neural pathways.'
        })
      });
    }

    if (url.includes('/recall/due')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 101,
            memory_id: 1,
            prompt_text: 'When and where is your scheduled cardiology review appointment?',
            category_name: 'Appointments',
            difficulty: 1,
            content: 'Cardiologist review at UNTH Ituku-Ozalla on Thursday at 10:00 AM'
          }
        ])
      });
    }

    if (url.includes('/exercises/next')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          technique_name: 'Method of Loci',
          description: 'Mentally navigate through your living room to remember your morning routine.',
          steps: [
            'Imagine standing at your front door.',
            'Visualize placing your medication on the center table.',
            'Mentally walk to the armchair and place your glasses.'
          ],
          target_category: 'Appointments'
        })
      });
    }

    if (url.includes('/chat/history')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { sender: 'ai', text: 'Good day, Margaret! How may I assist your memory practice today?' },
          { sender: 'user', text: 'Can you remind me what I have planned for this Thursday?' },
          { sender: 'ai', text: 'Certainly! You recorded an appointment with Dr. Okonkwo for your blood pressure review at 10:00 AM on Thursday.' }
        ])
      });
    }

    if (url.includes('/notifications')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([])
      });
    }

    if (url.includes('/analytics')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          overall_accuracy: 88.5,
          total_reviews: 42,
          active_memories: 18,
          recall_streak: 5,
          exercise_streak: 3,
          category_distribution: [
            { category: 'Names', accuracy: 85, forgotten_count: 2 },
            { category: 'Appointments', accuracy: 92, forgotten_count: 1 },
            { category: 'Tasks', accuracy: 80, forgotten_count: 3 },
            { category: 'Medications', accuracy: 95, forgotten_count: 0 },
            { category: 'Conversations', accuracy: 88, forgotten_count: 1 }
          ],
          motivational_message: 'Outstanding consistency! Your medication and appointment recall show exceptional strength.'
        })
      });
    }

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({})
    });
  });

  // 1. Login Page
  console.log('Navigating to Login...');
  await page.goto('https://memeor-aid1-hizl.vercel.app/login', { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(outDir, 'fig_4_3_login_snapshot.png') });
  console.log('Saved fig_4_3_login_snapshot.png');

  // Pre-seed authenticated localStorage
  await page.evaluate(() => {
    const testUser = {
      id: 1,
      email: 'margaret.okoro@example.com',
      name: 'Margaret Okoro',
      age_group: '51-65',
      checkin_time: '08:00',
      recall_streak: 5,
      exercise_streak: 3
    };
    localStorage.setItem('memoraid_token', 'mock_jwt_token_for_verification');
    localStorage.setItem('memoraid_user', JSON.stringify(testUser));
  });

  // 2. Dashboard
  console.log('Navigating to Dashboard...');
  await page.goto('https://memeor-aid1-hizl.vercel.app/dashboard', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, 'fig_4_4_dashboard_snapshot.png') });
  console.log('Saved fig_4_4_dashboard_snapshot.png');

  // 3. Log Memory
  console.log('Navigating to Log Memory...');
  await page.goto('https://memeor-aid1-hizl.vercel.app/log-memory', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, 'fig_4_5_memory_log_snapshot.png') });
  console.log('Saved fig_4_5_memory_log_snapshot.png');

  // 4. Recall
  console.log('Navigating to Recall...');
  await page.goto('https://memeor-aid1-hizl.vercel.app/recall', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, 'fig_4_6_recall_session_snapshot.png') });
  console.log('Saved fig_4_6_recall_session_snapshot.png');

  // 5. Exercises
  console.log('Navigating to Exercises...');
  await page.goto('https://memeor-aid1-hizl.vercel.app/exercises', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, 'fig_4_7_exercise_snapshot.png') });
  console.log('Saved fig_4_7_exercise_snapshot.png');

  // 6. Chat
  console.log('Navigating to Chat...');
  await page.goto('https://memeor-aid1-hizl.vercel.app/chat', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, 'fig_4_8_chat_companion_snapshot.png') });
  console.log('Saved fig_4_8_chat_companion_snapshot.png');

  // 7. Analytics
  console.log('Navigating to Analytics...');
  await page.goto('https://memeor-aid1-hizl.vercel.app/analytics', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, 'fig_4_9_analytics_snapshot.png') });
  console.log('Saved fig_4_9_analytics_snapshot.png');

  await browser.close();
  console.log('All 7 application snapshots captured successfully at high resolution!');
}

capture().catch((err) => {
  console.error('Capture error:', err);
  process.exit(1);
});
