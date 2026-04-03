import json
import os
import glob

data_dir = r"d:\workbox\exam-site\data"

report = []

for i in range(1, 17):
    filename = f"part{i}.json"
    filepath = os.path.join(data_dir, filename)
    if not os.path.exists(filepath):
        report.append(f"[{filename}] 파일이 존재하지 않습니다.")
        continue
    
    with open(filepath, 'r', encoding='utf-8') as f:
        try:
            data = json.load(f)
        except Exception as e:
            report.append(f"[{filename}] JSON 파싱 오류: {e}")
            continue
            
    questions = data.get("questions", [])
    if not questions:
        report.append(f"[{filename}] 문항이 하나도 없습니다.")
        continue
        
    diff_count = {"상": 0, "중": 0, "하": 0}
    issue_q = []
    
    for idx, q in enumerate(questions):
        diff = q.get("difficulty", "?")
        if diff in diff_count:
            diff_count[diff] += 1
            
        q_text = q.get("q", "")
        opts = q.get("opts", [])
        ans = q.get("ans", -1)
        
        # 기능사 수준 점검
        # 1. 보기가 4개가 아닌 경우
        if len(opts) != 4:
            issue_q.append({
                "index": idx + 1,
                "q": q_text[:30] + "...",
                "issue": f"보기가 {len(opts)}개입니다 (4지 선다 아님)"
            })
            
        # 해석(해설) 충실도 점검
        why = q.get("why", [])
        explainV2 = q.get("explainV2", {})
        
        issue_details = []
        if not explainV2:
            issue_details.append("explainV2(1타 강사 해설) 누락")
        else:
            core = explainV2.get("coreConcepts", [])
            opt_explains = explainV2.get("options", [])
            if not core or len(core) < 2:
                issue_details.append("coreConcepts 설명 빈약(2개 미만)")
            if len(opt_explains) < 4:
                issue_details.append("보기별 해설(options) 누락 또는 부족")
            
            # 모든 보기 해설 길이가 너무 짧은지
            opt_len = sum([len(opt.get("desc", "")) for opt in opt_explains])
            if opt_len < 40: # 전체 보기 설명이 40자 미만이면 너무 빈약함
                issue_details.append("보기 오답/정답 해설 텍스트 길이 매우 짧음")
                
        if issue_details:
             issue_q.append({
                "index": idx + 1,
                "q": q_text[:30] + "...",
                "issue": ", ".join(issue_details)
            })

    total_q = len(questions)
    
    # 보고서 작성
    report.append(f"\n### {filename} 분석 요약")
    report.append(f"- 총 문항 수: {total_q}")
    report.append(f"- 난이도 분포: 상({diff_count['상']}), 중({diff_count['중']}), 하({diff_count['하']})")
    
    # 난이도 분포 체크 (예: 상이 절반을 넘거나, 4:4:2 등 적절한 비율인지)
    if total_q > 0:
        if diff_count['상'] / total_q > 0.4:
            report.append("- ⚠️주의: '상' 난이도가 너무 많아 기능사 수준보다 어려울 수 있습니다.")
    
    if issue_q:
        report.append("- 부족한/오류 문항 리스트:")
        for issue in issue_q:
            report.append(f"  [{issue['index']}번] {issue['q']} => {issue['issue']}")
    else:
        report.append("- 문제 구성 및 해석 충실도 양호")

# 결과를 파일로 쓰기
out_path = os.path.join(data_dir, "analysis_report.txt")
with open(out_path, 'w', encoding='utf-8') as f:
    f.write("\n".join(report))

print("분석 완료")
