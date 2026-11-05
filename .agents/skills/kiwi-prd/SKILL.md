---
name: kiwi-prd
description: "사용자 요청을 조사·질문보다 먼저 원문 그대로 PRD 파일(docs/prd/)에 쓰고, 빠진 의도와 범위를 한 번에 하나씩 물어 짧은 PRD 로 정리한 뒤 승인을 받는 요구 수집 스킬. PRD 는 입력 기록이고 요구 원본은 docs/spec 의 SRS 다. 사용자 말과 에이전트 제안을 나눠 적고, 제외 항목을 함께 적어 SRS 가 요청보다 커지지 않게 한다. kiwi-srs·kiwi-tdd·kiwi-step·kiwi-orchestrator·kiwi-wave-master 가 PRD 없이 불리면 먼저 이 스킬을 부른다. 트리거 — kiwi prd, 요구사항 수집, 요구 정리, PRD 작성, 요구사항 문서로 남겨줘, $kiwi-prd. 옵션 — --auto, --qna-force."
---
> Kiwi MCP rule: normal target-scoped SRS reads, mutations, validation, status/stability updates, acceptance-criteria changes, evidence, trace links, and completed-work logging require working `speckiwi mcp`. CLI is diagnostic/remediation only and is not a normal replacement for MCP mutations.
# kiwi-prd v0.1

> Codex clarification gate means: ask the user directly in Default mode; use `request_user_input` only in Plan mode when that tool is available.

요청을 **원문 그대로 디스크에 먼저 남기고**, 무엇을 왜 만들고 무엇을 만들지 않는지를 짧은 PRD 로 정리해 승인받는다. 원문이 파일에 있으므로 컴팩션 뒤에도 사라지지 않고, 검증 루프는 이 PRD 와 SRS 를 대조한다(kiwi-srs 의 PRD 판정). 근거 요구: FR-FLOW-204.

## 1. 순서

1. 요청을 받으면 조사 서브에이전트·질문·SRS mutation 보다 먼저 `docs/prd/<YYYY-MM-DD>.<slug>.prd.md` 의 `## 1. User Request` 아래 `U-1` 블록에 요청을 **한 글자도 바꾸지 않고** 쓴다. 호출자가 `REQ_PATH` 문서를 넘기면 그 내용이 요청이다 — `U-1` 에 그 경로와 sha256 을 적고 내용을 한 글자도 바꾸지 않고 옮긴다. 이슈에서 왔으면 `U-1` 은 입력이 가리키는 이슈를 `gh issue view {N} --json title,body,comments` 로 읽은 제목과 본문 원문이다 — 발췌본(`issue-excerpt.md`)이면 그 첫 줄 `Issue: https://github.com/{owner}/{repo}/issues/{N}` 에서 번호를 읽고, 이슈에서 파생된 발췌본은 `U-1` 에 넣지 않고 참고 자료로만 보며 PRD 항목의 근거가 되지 못한다. 발췌본에 그 줄이 없을 때만 발췌본 자체를 `U-1` 원천으로 쓰고, 완료 보고에 `이슈 원문을 읽지 못함` 을 적는다.
2. 묻기 전에 본다. 호출자가 넘긴 입력, 사용자가 가리킨 파일, `search_requirements` 결과만 본다 — kiwi-prd 는 조사 서브에이전트보다 먼저 불리므로 볼 조사 산출물이 없다. 맥락이 답하는 것은 묻지 않는다. Search in both languages: put the words you would search for and their equivalents in the other language into the same query string (add English words to a Korean request; add Korean words to an English request or to a requirement you are writing in English).
3. 첫 메시지는 하나다: 요청을 자기 말로 짧게 되짚고, in-scope · exclusion 초안과 proposal 목록을 보인 뒤, 만들 것을 가장 크게 바꾸는 질문 하나로 끝낸다. "이대로 진행하라고 하셔도 됩니다" 한 줄을 붙인다.
4. 사용자의 답은 다음 `U-<n>` 블록으로 덧붙이기만 하고, 앞선 `U` 블록은 고쳐 쓰지 않는다. 답을 덧붙일 때 에이전트가 한 질문은 `> 질문:` 줄에, 사용자의 답은 그 아래 `> 답:` 줄에 적는다. 답을 반영해 항목을 고친다. 호출자가 요청에 관한 질문의 사용자 답을 넘기면 그 답도 다음 `U-<n>` 으로 원문 그대로 덧붙인다. `kiwi-srs` · `kiwi-tdd` · `kiwi-step` 이 항목 사이의 모순을 푼 해소를 넘기면 다음 번호의 `Kind=proposal` 항목으로 덧붙이고 `Reason` 을 `contradiction resolved:` 로 시작한다. 해소 proposal 은 `State=proposed` 를 유지하고, `State` 가 아니라 기록된 해소로서 효력을 가진다.
5. 경계를 바꾸는 미해결 질문이 0개이거나 사용자가 진행하라고 하면 묻기를 멈추고, PRD 를 보여 주어 승인을 받는다. 승인 문장은 `## 3. Approval` 에 그대로 옮기고 `Status` 행을 `approved` 로 바꾼다. 사용자가 PRD 를 승인하면 사용자에게 보여 주었고 그 답에서 거절되지 않은 proposal 은 모두 `State` 를 `confirmed` 로 바꾼다 — `Reason` 이 `contradiction resolved:` 로 시작하는 proposal 만 `proposed` 로 남긴다.
6. PRD 가 승인되기 전에는 어떤 SRS mutation 도구도 부르지 않는다.
7. `U` 블록을 쓰거나 덧붙일 때마다(`--auto` 포함) kiwi-prd 가 줄 끝을 LF 로 맞춘 `## 1. User Request` 절 바이트의 sha256 을 `Request SHA256` 행에 쓴다 — 이 행은 kiwi-prd 만 쓰고 다른 스킬은 읽기만 한다.
8. 끝나면 PRD 경로를 돌려준다. 단독 실행이면 다음 단계로 `$kiwi-srs REQ_PATH=<PRD 경로>` 를 안내한다. 선택 입력 `ROADMAP_ITEM=RM-<n>` 을 받았으면 호출자가 있어도 다음 단계를 `$kiwi-srs REQ_PATH=<PRD 경로> ROADMAP_ITEM=RM-<n>` 으로 안내한다. kiwi-prd 는 로드맵 도구를 부르지 않는다.

## 2. 질문 방식

- 메시지 하나에 질문은 **하나만** 하고, 요청에 목적이 없으면 왜 필요한지를 묻고, 그 밖에는 답에 따라 in-scope 나 exclusion 항목이 바뀌는 점만 묻는다.
- 세부 기본값은 묻지 않고 proposal 목록으로 보여 주어, 사용자가 답장 한 번으로 고치게 한다.
- 열린 질문이 먼저다. 선택지는 사용자가 막혔을 때만 준다.
- 리서치 문서가 없어도 모호성은 스스로 찾는다. 합리적 기본값이 있는 것은 proposal 로 정하고, 기본값이 없는 비표준 모호성만 묻는다. 사용자의 답변이 만든 결정도 재검사해, 새 모호성이 생기면 재질문한다.
- 질문 루프는 라운드 상한이 없는 무제한 qna 루프다 — 경계를 바꾸는 질문이 남아 있는 한 하나씩 계속 묻는다. 요청이 막연하면(예: "게임을 하나 만들어줘") 플래그 없이도 질문 루프를 자동 활성한다. `--qna-force` 는 호출자의 연구만으로 요구가 모호하다는 신호다 — 맥락이 답한 것처럼 보이는 모호성도 proposal 로 정해 넘기지 않고 사용자에게 하나씩 물어 해소하며, 사용자가 진행하라고 하기 전에는 승인 단계로 가지 않는다.
- 같은 질문이 두 번 나오면 더 묻지 않고, 남은 모호성을 기록한 채 진행할지 묻는다.
- `--auto` 없이 도는 중에 사용자가 종료 신호("이제 그만", "여기서 종료")를 보내면 더 묻지 않고, 남은 모호성을 자동 결정해 각각 `Reason` 을 단 proposal 로 적는다.
- `--auto` 에서는 질문 없이 원문에서 항목을 뽑고 `Status` 행을 `unapproved` 로 둔 채 돌려주며, 결정 위원회는 proposal 만 정할 수 있고 in-scope 항목을 더하거나 exclusion 항목을 지우지 못한다. `Effect` 가 in-scope 인 proposal 을 `State=confirmed` 로 바꿀 수 있는 것은 사용자 자신의 답뿐이므로, `--auto` 에서 결정 위원회가 정한 그런 proposal 은 `proposed` 로 남고 in-scope 항목으로 세지 않는다. `--auto` 로 만든 PRD 는 `Approved` 행에 `--auto` 를 적는다. `--auto` 는 질문 루프와 `--qna-force` 를 억제하고 남은 모호성을 FR-FLOW-025 결정 위원회에 위임한다. 미승인 PRD 를 받은 호출자는 완료 보고에 그 `Status` 행 값을 그대로 싣는다.

## 3. PRD 문법

- 항목은 `## 2. Items` 아래 `### PRD-<n> — <제목>` 블록으로 1부터 빠짐없이 번호를 매긴다. 문서 순서가 곧 순회 순서다.
- `Kind` 는 `intent` · `user` · `goal` · `in-scope` · `exclusion` · `proposal` 가운데 하나, `State` 는 `confirmed` · `proposed` · `rejected` 가운데 하나다.
- `Kind=intent` 항목은 적어도 하나 있어야 한다 — 단 `--auto` 로 `Status` 행이 `unapproved` 이고 요청에 목적이 없을 때만, `Reason` 이 `inferred intent:` 로 시작하는 proposal 이 그 자리를 대신한다.
- `Kind=exclusion` 항목만 `Exclusion Class` 행을 갖고, 값은 `already-implemented` · `superseded` · `external-ownership` · `user-excluded` · `non-normative` 가운데 하나다.
- proposal 이 아닌 항목은 `Source` 가 가리키는 `U` 블록에 그대로 있는 구절을 인용 블록 하나로 옮긴다. `Source` 는 `U-<n>` 을 쉼표로 나열한다. 인용은 사용자 자신의 말이어야 한다 — `U-1` 이 아니고 `답:` 줄이 있는 `U` 블록에서 `질문:` 줄부터 다음 `답:` 줄 앞까지는 에이전트의 질문이므로 인용이 될 수 없다.
- 요청이 설계·연구 문서이면 그 문서의 규범 문장(시스템이 해야 하는 일이나 범위 안팎을 정하는 문장) 하나마다 항목 하나를 만들어 그 문장을 그대로 인용하고, 규범 문장 둘을 한 항목에 합치지 않는다.
- 에이전트가 채운 것은 모두 `Kind=proposal` 과 `Reason` 행으로 적고, 사용자가 받아들여도 `State` 만 `confirmed` 로 바꾸며 `Kind=proposal` 은 그대로 둔다.
- proposal 은 확정되면 무엇을 더하는지 밝히는 `Effect` 행을 갖고, 값은 `in-scope` · `exclusion` 가운데 하나다 — 확정된 proposal 은 `Effect` 가 in-scope 이면 in-scope 항목처럼, exclusion 이면 exclusion 항목처럼 판정된다.
- PRD 에는 Requirement ID · AC 줄 · `SHALL` 문장을 쓰지 않고, 맨 위에 입력 기록이며 요구 원본은 `docs/spec` 이라고 적는다. (`U` 블록, proposal 이 아닌 항목이 `U` 블록에서 옮긴 인용, `## 3. Approval` 의 승인 인용만 사용자의 말이므로 무엇이 들어 있어도 그대로 두고 검사를 통과시키려고 고쳐 쓰지 않는다 — proposal 의 인용 줄과 승인 절의 인용 밖 줄을 포함한 나머지는 모두 검사한다.)
- 사용자가 넘긴 문서는 `U-<n>` 에 경로와 sha256 을 적은 뒤에만 인용한다.

```markdown
# PRD: <제목>

> 입력 기록이다. 요구 원본이 아니다 — 무엇을 만들지는 `docs/spec` 의 SRS 가 정한다.
> 이 문서는 kiwi-prd 만 쓴다. 검증·개선 루프는 읽기만 한다.

| Field | Value |
|---|---|
| Status | unapproved |
| Approved | - |
| Request SHA256 | - |

## 1. User Request

### U-1 — <YYYY-MM-DD> request

> <요청 원문, 바이트 그대로>

## 2. Items

### PRD-1 — <제목>

| Field | Value |
|---|---|
| Kind | intent |
| Source | U-1 |
| State | confirmed |

> <U-1 에 그대로 있는 구절>

<한두 줄 풀이>

## 3. Approval

> <사용자 승인 문장 그대로>
```

## 4. 기계 검사

PRD 를 쓰거나 고친 뒤 두 명령을 돌린다. 둘 다 종료 코드 0 이어야 승인을 받는다.

```bash
# prd-hash: 줄 끝을 LF 로 맞춘 User Request 절의 sha256 을 출력하고, Request SHA256 행과 다르면 종료 코드 1
node -e "const f=require('fs').readFileSync(process.argv[1],'latin1').replace(/\r\n/g,'\n');const a=f.indexOf('\n## 1. User Request')+1;const b=f.indexOf('\n## ',a)+1;if(a<1||b<=a)process.exit(2);const h=require('crypto').createHash('sha256').update(f.slice(a,b),'latin1').digest('hex');console.log(h);const r=f.split('\n').find(l=>l.startsWith('| Request SHA256 |'));process.exit(r&&r.includes(h)?0:1)" docs/prd/<file>.prd.md
# prd-quote: 번호·Kind·State·Exclusion Class·Reason·Effect·인용(`U-1` 이 아닌 질문·답 블록의 질문 줄은 인용 원천에서 뺀다)과 intent 항목 유무, `U` 블록·인용·승인 인용 밖의 요구 문법, `## 2. Items` 밖의 `### PRD-` 줄을 검사하고 항목 수를 출력, 어긋나면 종료 코드 1
node -e "const f=require('fs').readFileSync(process.argv[1],'utf8').replace(/\r\n/g,'\n');const sec=h=>{const a=f.indexOf('\n'+h+'\n');const b=f.indexOf('\n## ',a+1);return a<0?'':f.slice(a+1,b<0?f.length:b+1)};const blk=(s,p)=>s.split('\n### ').slice(1).filter(x=>x.startsWith(p));const quo=x=>x.split('\n').filter(l=>l.startsWith('>')).map(l=>l.replace(/^> ?/,'')).join('\n').trim();const val=(x,k)=>((x.split('\n').find(l=>l.startsWith('| '+k+' |'))||'').split('|')[2]||'').trim();const U={};blk(sec('## 1. User Request'),'U-').forEach(x=>{let q=0;const id=x.split(' ')[0],t=quo(x);U[id]=id==='U-1'||/^답:/m.test(t)===false?t:t.split('\n').filter(l=>{q=l.startsWith('답:')?0:l.startsWith('질문:')?1:q;return q===0}).join('\n')});const K=['intent','user','goal','in-scope','exclusion','proposal'],S=['confirmed','proposed','rejected'],E=['already-implemented','superseded','external-ownership','user-excluded','non-normative'];const err=[];const it=blk(sec('## 2. Items'),'PRD-');const auto=val(f,'Status')==='unapproved'&&val(f,'Approved')==='--auto';if(it.some(x=>val(x,'Kind')==='intent'||(auto&&val(x,'Kind')==='proposal'&&val(x,'Reason').startsWith('inferred intent:')))===false)err.push('no intent item');it.forEach((x,i)=>{const id='PRD-'+(i+1);if(x.startsWith(id+' ')===false)err.push(id+' numbering');const k=val(x,'Kind');if(K.includes(k)===false)err.push(id+' Kind');if(S.includes(val(x,'State'))===false)err.push(id+' State');if((k==='exclusion')^E.includes(val(x,'Exclusion Class')))err.push(id+' Exclusion Class');if(k==='proposal'){if(val(x,'Reason')==='')err.push(id+' Reason');if(['in-scope','exclusion'].includes(val(x,'Effect'))===false)err.push(id+' Effect')}else{const q=quo(x),src=val(x,'Source').split(/[ ,]+/).filter(s=>s);if(q===''||src.length===0||src.every(s=>s in U)===false||src.some(s=>U[s].includes(q))===false)err.push(id+' quote')}});let rest=f.replace(sec('## 1. User Request'),'');it.forEach(x=>{if(val(x,'Kind')==='proposal')return;rest=rest.replace(x,()=>x.split('\n').filter(l=>l.startsWith('>')===false).join('\n'))});rest=rest.replace(sec('## 3. Approval'),x=>x.split('\n').filter(l=>l.startsWith('>')===false).join('\n'));rest=rest.split('\n').map(l=>l.replace(/^(>\s?)+/,'')).join('\n');if(/\b(FR|NFR|IR|DR|SEC|PERF|REL|OBS|OPS|MIG|CON)-[A-Z0-9][A-Z0-9-]{1,24}-[0-9]{3,4}\b|\bSHALL\b|^\s*[-*]?\s*(\[.\]\s*)?AC-[0-9]+\b/m.test(rest))err.push('requirement grammar outside the user request');if(f.split('\n').filter(l=>l.startsWith('### PRD-')).length!==it.length)err.push('PRD item outside ## 2. Items');console.log(it.length+' items');if(err.length){console.log(err.join('\n'));process.exit(1)}" docs/prd/<file>.prd.md
```

`prd-quote` 가 출력한 항목 수가 kiwi-srs 의 `prd_items[]` 길이 기준이다. 명령이 실패하면 고친 뒤 다시 돌리고, `U` 블록이나 승인 인용을 고쳐서 맞추지 않는다.
