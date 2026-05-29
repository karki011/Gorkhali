# Git Forensic Commands & Recipes

Author: Subash Karki

Ready-to-use git commands for each investigation step. Copy-paste and substitute file paths.

---

## Step 2: Timeline Reconstruction

**Recent commits touching suspect files (last 6 months):**
```bash
git log --since="6 months ago" --pretty=format:"%h %ad %an — %s" --date=short -- {FILE_PATH}
```

**Find when behavior changed (bisect):**
```bash
git bisect start
git bisect bad HEAD
git bisect good {LAST_KNOWN_GOOD_SHA}
# Then run your test at each step
git bisect run {TEST_COMMAND}
```

**Commits between two dates:**
```bash
git log --after="2026-05-01" --before="2026-05-15" --pretty=format:"%h %ad %an — %s" --date=short -- {FILE_PATH}
```

---

## Step 3: Hotspot Detection

**Change frequency (top 20 most-changed files in 6 months):**
```bash
git log --since="6 months ago" --pretty=format: --name-only | sort | uniq -c | sort -rn | head -20
```

**Change frequency for a specific directory:**
```bash
git log --since="6 months ago" --pretty=format: --name-only -- src/services/ | sort | uniq -c | sort -rn | head -20
```

---

## Step 4: Ownership

**Who owns a file (by commit count):**
```bash
git shortlog -sn --since="6 months ago" -- {FILE_PATH}
```

**Bus factor (contributors needed for 50% of commits):**
```bash
git shortlog -sn --since="6 months ago" -- {FILE_PATH} | awk '{total+=$1; print $0} END{print "---"; half=total/2; running=0; for(i=1;i<=NR;i++){running+=$1; if(running>=half){print "Bus factor:",i; break}}}'
```

---

## Step 5: Coupling Detection

**Files that co-change with a suspect (same commit):**
```bash
git log --pretty=format:"%H" -- {SUSPECT_FILE} | while read sha; do
  git diff-tree --no-commit-id --name-only -r "$sha"
done | sort | uniq -c | sort -rn | head -10
```

**Check if coupled file was updated in same PR/commit range:**
```bash
git log {FIRST_SHA}..{LAST_SHA} --pretty=format: --name-only | sort -u | grep -c "{COUPLED_FILE}"
# 0 = MISSING co-change (red flag)
```

---

## Step 7: Evidence Collection

**Diff of the suspected commit:**
```bash
git show {COMMIT_SHA} --stat
git show {COMMIT_SHA} -- {FILE_PATH}
```

**Blame the specific line range:**
```bash
git blame -L {START},{END} {FILE_PATH}
```

**Find when a specific line was introduced:**
```bash
git log -S "{SEARCH_STRING}" --pretty=format:"%h %ad %an — %s" --date=short
```
