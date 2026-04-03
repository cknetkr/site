import json
import os
import random

data_dir = r"d:\workbox\exam-site\data"

processed_files = []

for i in range(1, 17):
    filename = f"part{i}.json"
    filepath = os.path.join(data_dir, filename)
    if not os.path.exists(filepath):
        continue
        
    with open(filepath, 'r', encoding='utf-8') as f:
        try:
            data = json.load(f)
        except Exception as e:
            print(f"{filename} 로드 실패: {e}")
            continue
            
    questions = data.get("questions", [])
    total_q = len(questions)
    
    if total_q == 0:
        continue
        
    # 1. 메타데이터 count 업데이트
    if "meta" not in data:
        data["meta"] = {}
    
    data["meta"]["count"] = total_q
    
    # 2. 난이도 비율 (4:4:2) 에 따른 개수 계산
    count_hard = int(total_q * 0.2)
    count_easy = int(total_q * 0.4)
    count_mid = total_q - count_hard - count_easy
    
    data["meta"]["difficultyRatio"] = "4:4:2"
    data["meta"]["difficultyCount"] = {
        "하": count_easy,
        "중": count_mid,
        "상": count_hard
    }
    
    # 3. difficulty 누락 또는 재설정이 필요한 파일 (part 1, 2, 3, 10 등) 처리
    needs_reassignment = any("difficulty" not in q for q in questions)
    
    if needs_reassignment:
        diff_list = ["하"] * count_easy + ["중"] * count_mid + ["상"] * count_hard
        random.seed(i) # 파일별 일정하게 섞이도록
        random.shuffle(diff_list)
        
        for idx, q in enumerate(questions):
            q["difficulty"] = diff_list[idx]
            
        processed_files.append(f"{filename} (난이도 및 카운트 업데이트 됨: 하 {count_easy}, 중 {count_mid}, 상 {count_hard})")
    else:
        # 난이도가 이미 있는 파일(part 4~16)이라도 카운트 갱신은 수행함
        processed_files.append(f"{filename} (카운트만 업데이트 됨: {total_q}개)")
            
    # 저장
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

print("\n".join(processed_files))
print("업데이트 완료")
