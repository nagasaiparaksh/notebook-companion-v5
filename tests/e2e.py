"""End-to-end test of Notebook Companion in a real browser (Microsoft Edge or Chrome via Playwright).

    backend\\.venv\\Scripts\\python.exe tests\\e2e.py            # test mode: AI + Gnani mocked (fast, free, repeatable)
    backend\\.venv\\Scripts\\python.exe tests\\e2e.py --live     # same checks against the real AI + Gnani (uses credits)

It starts its own server on a fresh, empty database (your notebooks are never touched), uses a fake microphone,
and prints a pass/fail line per feature plus every page crash, console error and failed request it saw."""
import io, json, os, re, shutil, subprocess, sys, tempfile, time, traceback, urllib.request, zipfile
from playwright.sync_api import sync_playwright, expect

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); BACK = os.path.join(ROOT, "backend")
LIVE = "--live" in sys.argv; PORT = 5099; BASE = f"http://127.0.0.1:{PORT}"; T = 90000 if LIVE else 20000
tmp = tempfile.mkdtemp(prefix="nc_e2e_"); SHOTS = os.path.join(tmp, "shots"); os.makedirs(SHOTS)
env = {**os.environ, "DATABASE_PATH": os.path.join(tmp, "e2e.db"), "PORT": str(PORT), "BACKUP_DIR": os.path.join(tmp, "backups"), "NC_MOCK": "0" if LIVE else "1"}
server = subprocess.Popen([os.path.join(BACK, ".venv", "Scripts", "python.exe"), "-u", "app.py"], cwd=BACK, env=env, stdout=open(os.path.join(tmp, "server.log"), "w"), stderr=subprocess.STDOUT)
for _ in range(60):
    try: urllib.request.urlopen(BASE + "/api/languages", timeout=2); break
    except Exception: time.sleep(1)
else: server.kill(); sys.exit("server did not start; see " + os.path.join(tmp, "server.log"))

results, issues = [], []
def check(name):
    def wrap(fn):
        t0 = time.time(); n_issues = len(issues)
        try: fn(); ok, note = True, ""
        except Exception as e: ok, note = False, (str(e).splitlines() or [repr(e)])[0][:220]; page.screenshot(path=os.path.join(SHOTS, re.sub(r"\W+", "_", name) + ".png"))
        new = issues[n_issues:]
        if ok and any(x.startswith(("PAGE CRASH", "console error")) for x in new): ok, note = False, "browser error: " + next(x for x in new if x.startswith(("PAGE CRASH", "console error")))[:200]
        results.append((name, ok, time.time() - t0, note)); print(f"{'PASS' if ok else 'FAIL'}  {name:46} {time.time()-t0:5.1f}s  {note}", flush=True)
        return fn
    return wrap

def editor(): return page.locator(".page-editor")
def sheet_text(): return editor().inner_text()
def typecmd(text, wait_change=True, timeout=T):
    if not page.locator(".dock-type input").count(): page.get_by_title("Type a command or note instead of speaking").click()
    before = sheet_text(); page.locator(".dock-type input").fill(text); page.locator(".dock-type button").click()
    if wait_change: page.wait_for_function("b => document.querySelector('.page-editor').innerText !== b", arg=before, timeout=timeout)
    else: page.wait_for_function("() => !/Thinking/.test(document.querySelector('.mic-label').innerText)", timeout=timeout)
def caption(): return " | ".join(page.locator(".caption").all_inner_texts())
def idle(timeout=T): page.wait_for_function("() => !/Thinking|Working out|Organizing|Drawing/.test((document.querySelector('.mic-label')||{}).innerText + ((document.querySelector('.caption')||{}).innerText||''))", timeout=timeout)

with sync_playwright() as p:
    try: browser = p.chromium.launch(channel="msedge", headless=True, args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"])
    except Exception: browser = p.chromium.launch(channel="chrome", headless=True, args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"])
    ctx = browser.new_context(viewport={"width": 1366, "height": 860}, accept_downloads=True); ctx.grant_permissions(["microphone"], origin=BASE)
    page = ctx.new_page(); page.set_default_timeout(T)
    page.on("pageerror", lambda e: issues.append(f"PAGE CRASH: {str(e)[:300]}"))
    page.on("console", lambda m: m.type == "error" and "Failed to load resource" not in m.text and issues.append(f"console error: {m.text[:300]}"))
    page.on("response", lambda r: r.status >= 500 and issues.append(f"HTTP {r.status} {r.request.method} {r.url.replace(BASE, '')}"))
    page.on("requestfailed", lambda r: "/api/" in r.url and "ERR_ABORTED" not in str(r.failure) and issues.append(f"request failed {r.url.replace(BASE, '')}: {r.failure}"))

    @check("home page loads")
    def _():
        page.goto(BASE + "/", wait_until="networkidle"); expect(page.get_by_text("Create new notebook")).to_be_visible(); expect(page.get_by_text("New here?")).to_be_visible()

    @check("create a notebook and rename it")
    def _():
        page.get_by_text("Create new notebook").click(); page.wait_for_url("**/n/*"); editor().wait_for()
        page.get_by_label("Notebook title").fill("E2E Biology"); page.wait_for_function("() => /^saved$/.test(document.querySelector('.nb-saved').innerText)", timeout=10000)

    @check("typing is saved and survives a reload")
    def _():
        editor().click(); page.keyboard.type("Chlorophyll absorbs light energy."); page.wait_for_function("() => /^saved$/.test(document.querySelector('.nb-saved').innerText)", timeout=10000)
        page.reload(wait_until="networkidle"); expect(editor()).to_contain_text("Chlorophyll absorbs light energy."); expect(page.get_by_label("Notebook title")).to_have_value("E2E Biology")

    @check("dictation (typed) is written into the sheet")
    def _(): typecmd("Plants make glucose from sunlight."); assert "Plants make glucose from sunlight" in sheet_text()

    @check("command: new sheet, then go back to sheet 1")
    def _():
        typecmd("add a new sheet", wait_change=False); expect(page.locator(".pager")).to_contain_text("Sheet 2 of 2")
        typecmd("go to sheet 1", wait_change=False); expect(page.locator(".pager")).to_contain_text("Sheet 1 of 2"); assert "Chlorophyll" in sheet_text()

    @check("compose: heading + summary")
    def _(): typecmd("put a heading Photosynthesis and add a short summary"); idle(); expect(editor().locator("h2").first).to_contain_text("Photosynthesis")

    @check("compose: diagram is drawn onto the sheet")
    def _():
        n = page.locator(".obj").count(); typecmd("put a heading Respiration and a diagram of respiration", wait_change=False); idle()
        page.wait_for_function(f"() => document.querySelectorAll('.obj').length > {n}", timeout=T)

    @check("study material: a long spoken request becomes questions + code")
    def _():
        req = ("I have an exam tomorrow on this topic of Spring Boot, so there might be situational questions. And I'll have to answer them with codes, with written codes, "
               "so help me and... By generating some 3 to 4 situational questions and its answers. To get a good handle on Spring Boot, you should start by learning how to use starter dependencies.")
        pages = page.locator(".pager").inner_text(); typecmd(req, wait_change=False); idle(timeout=T + 60000)
        page.wait_for_function("p => document.querySelector('.pager').innerText !== p", arg=pages, timeout=T + 60000)
        assert "I have an exam tomorrow" not in sheet_text(), "the request was pasted as dictation"
        assert editor().locator("pre.code").count() >= 1, "no code block"; assert editor().locator("p.q").count() >= 1, "no question"
        typecmd("go to sheet 1", wait_change=False)

    @check("edit: change the current heading")
    def _(): editor().locator("h2").first.click(); typecmd("change the heading to Food From Light"); expect(editor()).to_contain_text("Food From Light")

    @check("edit: replace words")
    def _(): typecmd("replace glucose with sugar"); assert "sugar" in sheet_text() and "glucose from sunlight" not in sheet_text()

    @check("undo, then redo")
    def _():
        typecmd("undo"); assert "glucose from sunlight" in sheet_text(), "undo didn't restore"
        page.get_by_title("Redo what Undo took back (or say “redo”)").click(); page.wait_for_timeout(300); assert "sugar" in sheet_text(), "redo didn't re-apply"

    @check("selection bar: bold + read selection")
    def _():
        page.evaluate("""() => { const p = [...document.querySelectorAll('.page-editor p')].find(x => x.innerText.includes('Chlorophyll')); const r = document.createRange(); r.selectNodeContents(p); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }""")
        page.locator(".selbar").wait_for(); page.get_by_label("Bold").click(); page.wait_for_timeout(200); assert editor().locator("b, strong").count() > 0, "no bold text"
        page.get_by_label("Read the selected text aloud").click(); page.wait_for_function("() => /Speaking|voice ready/.test(document.querySelector('.mic-label').innerText)", timeout=T)
        page.locator(".mic").click()

    @check("read this sheet aloud")
    def _():
        typecmd("read this sheet aloud", wait_change=False); page.wait_for_function("() => /Speaking/.test(document.querySelector('.mic-label').innerText)", timeout=T); page.locator(".mic").click()

    @check("delete: a line, then a sheet")
    def _():
        typecmd("delete the paragraph about chlorophyll"); assert "Chlorophyll absorbs" not in sheet_text()
        n = int(re.search(r"of (\d+)", page.locator(".pager").inner_text()).group(1))
        typecmd("delete sheet 2", wait_change=False); expect(page.locator(".pager")).to_contain_text(f"of {n - 1}")

    @check("organize: preview, then apply")
    def _():
        typecmd("tidy up this sheet", wait_change=False); page.locator(".modal.org").wait_for(timeout=T); expect(page.locator(".org-page.after").first).to_be_visible()
        page.get_by_role("button", name="Apply").click(); expect(page.locator(".modal.org")).to_have_count(0)

    @check("companion: ask, answer streams, add to notes")
    def _():
        page.get_by_role("button", name="Companion").click(); page.locator(".companion-drawer textarea").fill("What does my sheet say about plants?"); page.locator(".companion-drawer textarea").press("Enter")
        page.locator(".bubble.ai").filter(has_text="photosynthesis").first.wait_for(timeout=T); page.locator(".mic").click() if "Speaking" in page.locator(".mic-label").inner_text() else None
        page.get_by_role("button", name="📌 Add to notes").first.click(); editor().locator("blockquote.ai-note").first.wait_for()
        page.get_by_role("button", name="Companion").click()

    @check("study: quiz loads in two parts and can be answered")
    def _():
        page.get_by_role("button", name="Study").click(); page.locator(".study-q").wait_for(timeout=T)
        page.locator(".study-opt").first.click(); expect(page.locator(".study-exp")).to_be_visible()
        page.wait_for_function("() => !/more coming/.test(document.querySelector('.study-body').innerText)", timeout=T)
        assert re.search(r"of (\d+)", page.locator(".study-body .muted").first.inner_text()) and int(re.search(r"of (\d+)", page.locator(".study-body .muted").first.inner_text()).group(1)) > 3, "second part never arrived"

    @check("study: flashcards and what-did-I-miss + add to notes")
    def _():
        page.get_by_role("tab", name="Flashcards").click(); page.locator(".flash").wait_for(timeout=T); page.locator(".flash").click(); expect(page.locator(".flash.back")).to_be_visible()
        page.get_by_role("tab", name="What did I miss?").click(); page.get_by_text("Missing from your notes").wait_for(timeout=T)
        page.get_by_role("button", name="📌 Add here as a note box").first.click(); page.get_by_role("button", name="Close").first.click(); expect(page.locator(".modal.study")).to_have_count(0)

    @check("course material: upload a text file")
    def _():
        page.get_by_role("button", name=re.compile("Course material")).click()
        page.locator(".modal.materials input[type=file]").set_input_files({"name": "syllabus.txt", "mimeType": "text/plain", "buffer": b"Unit 1 covers light reactions, the Calvin cycle and chlorophyll. Students learn how ATP and NADPH are produced."})
        page.locator(".mat-item").first.wait_for(timeout=T); expect(page.locator(".mat-item").first).to_contain_text("syllabus.txt")

    @check("syllabus coverage meter")
    def _():
        page.locator(".cov-pct").wait_for(timeout=T); assert page.locator(".cov-list li").count() >= 2; expect(page.get_by_role("button", name=re.compile("Course material.*covered"))).to_be_visible()

    @check("accuracy test (records 20 s with the fake mic)")
    def _():
        page.get_by_role("button", name="Record a 20 s test").click(); page.locator(".cmp-sum").wait_for(timeout=T + 30000); page.keyboard.press("Escape")
        if page.locator(".modal.materials").count(): page.locator(".modal.materials").get_by_role("button", name="Close").click()

    @check("lecture mode: live captions, stop, make notes")
    def _():
        n_sheets = int(re.search(r"of (\d+)", page.locator(".pager").inner_text()).group(1))
        page.get_by_role("button", name="Lecture mode").click(); page.get_by_role("button", name="● Start").click()
        page.locator(".lec-mode").wait_for(timeout=T)
        if LIVE: expect(page.locator(".lec-mode.live")).to_be_visible(); page.wait_for_timeout(4000)   # the fake mic only beeps: check the real Gnani live link opens
        else:
            page.wait_for_function("() => document.querySelectorAll('.lec-text p').length >= 3 || /pieces/.test(document.querySelector('.lec-mode').className)", timeout=T)
            if "pieces" in page.locator(".lec-mode").get_attribute("class"): page.wait_for_timeout(25000)   # fallback mode: wait for a piece
        page.get_by_role("button", name="■ Stop").click(); page.locator("textarea.lec-text").wait_for(timeout=T)
        page.locator("textarea.lec-text").fill(page.locator("textarea.lec-text").input_value() + " " + "Plants turn light into chemical energy in the chloroplast. " * 4)
        page.get_by_role("button", name="✦ Make notes").click(); page.wait_for_function(f"() => /of (\\d+)/.exec(document.querySelector('.pager').innerText)[1] > {n_sheets}", timeout=T)
        expect(page.locator(".companion-drawer.lecture")).to_have_count(0)

    @check("export: Markdown, Word and PDF download")
    def _():
        for label in ("⬇ Markdown (.md)", "📝 Word (.docx)", "📄 PDF"):
            page.get_by_role("button", name="File ▾").click()
            with page.expect_download(timeout=T) as d: page.get_by_role("menuitem", name=label).click()
            assert os.path.getsize(d.value.path()) > 200, label + " download is empty"

    @check("import a Word document into sheets")
    def _():
        W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'; b = io.BytesIO(); z = zipfile.ZipFile(b, "w")
        z.writestr("word/document.xml", f'<w:document {W}><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Imported Heading</w:t></w:r></w:p><w:p><w:r><w:t>Imported paragraph text.</w:t></w:r></w:p></w:body></w:document>'); z.close()
        page.get_by_role("button", name="File ▾").click(); page.locator(".filemenu input[accept*=docx]").set_input_files({"name": "notes.docx", "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "buffer": b.getvalue()})
        expect(editor()).to_contain_text("Imported Heading", timeout=T)

    @check("settings: notebook language")
    def _():
        page.get_by_role("button", name="Settings").click(); page.locator(".vset-pop select").first.select_option("te-IN,en-IN"); page.keyboard.press("Escape")
        page.wait_for_function("() => /^saved$/.test(document.querySelector('.nb-saved').innerText)", timeout=10000)

    @check("backups: download all + restore")
    def _():
        page.goto(BASE + "/", wait_until="networkidle")
        with page.expect_download(timeout=T) as d: page.get_by_text("Download all notebooks").click()
        path = d.value.path(); data = json.load(open(path, encoding="utf-8")); assert data["notebooks"], "backup has no notebooks"
        page.locator(".backup-box input[type=file]").set_input_files(path); expect(page.get_by_text(re.compile("Restored 0 notebooks|already had"))).to_be_visible(timeout=T)

    @check("open a Word document as a new notebook")
    def _():
        W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'; b = io.BytesIO(); z = zipfile.ZipFile(b, "w")
        z.writestr("word/document.xml", f'<w:document {W}><w:body><w:p><w:r><w:t>From Word on the home page.</w:t></w:r></w:p></w:body></w:document>'); z.close()
        page.locator("main input[accept*=docx]").set_input_files({"name": "Home Import.docx", "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "buffer": b.getvalue()})
        page.wait_for_url("**/n/*"); expect(editor()).to_contain_text("From Word on the home page.")

    @check("impact page shows real numbers + feedback")
    def _():
        page.goto(BASE + "/#/impact", wait_until="networkidle"); page.get_by_text("Listening (Gnani Prisma v3)").wait_for()
        page.get_by_label("Feedback").fill("E2E feedback line"); page.get_by_role("button", name="Send feedback").click(); expect(page.locator(".quotes")).to_contain_text("E2E feedback line")

    @check("guided tour: all 8 steps")
    def _():
        page.goto(BASE + "/", wait_until="networkidle"); page.evaluate("localStorage.removeItem('tourDone')"); page.reload(wait_until="networkidle")
        page.get_by_role("button", name="Start the tour").click(); page.locator(".tour").wait_for()
        for step in range(1, 9):
            card = page.locator(".tour"); tryb = card.get_by_role("button", name=re.compile("Try it"))
            if tryb.count():
                tryb.click(); page.wait_for_timeout(600); idle()
                if page.locator(".modal.study").count(): page.locator(".modal.study").get_by_role("button", name="Close").first.click()
                if "Speaking" in page.locator(".mic-label").inner_text() or "voice ready" in page.locator(".mic-label").inner_text(): page.locator(".mic").click()
            if step < 8: card.get_by_role("button", name="Next ›").click()
            else: card.get_by_role("button", name="Finish").click()
        expect(page.locator(".tour")).to_have_count(0); expect(editor().locator("h2").first).to_contain_text(re.compile("Photosynthesis|Food"))

    @check("phone-size screen: notebook usable, no sideways scroll")
    def _():
        page.set_viewport_size({"width": 390, "height": 844}); page.goto(BASE + "/", wait_until="networkidle"); page.locator(".cover-open").first.click(); editor().wait_for()
        over = page.evaluate("() => document.documentElement.scrollWidth - window.innerWidth"); assert over <= 2, f"page is {over}px wider than the phone screen"
        expect(page.locator(".mic")).to_be_visible(); page.set_viewport_size({"width": 1366, "height": 860})

    browser.close()

server.terminate()
fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} passed ({'LIVE AI + Gnani' if LIVE else 'test mode'})")
other = [x for x in dict.fromkeys(issues) if not x.startswith(("PAGE CRASH", "console error"))]
if issues: print("\nbrowser issues seen:"); [print("  " + x) for x in dict.fromkeys(issues)]
print("screenshots of failures:", SHOTS); print("server log:", os.path.join(tmp, "server.log"))
sys.exit(1 if fails else 0)
