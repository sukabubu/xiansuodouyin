import argparse
import csv
import json
import os
import time
import urllib.request
import urllib.error
from datetime import datetime, timedelta, timezone

DEFAULT_NAME_EXCLUDES = [
    "货代", "物流", "海外仓", "虚拟仓", "专线", "代贴", "贴面单",
    "服务商", "招商", "陪跑", "培训", "代运营", "合规", "认证", "检测",
    "ip", "i.p", "网络", "浏览器", "出海", "跨境", "电商", "外贸",
    "tk", "tiktok", "temu", "shopee", "虾皮", "亚马逊", "ozon",
    "小店", "店铺", "美区", "本土店", "创业日记", "真实跨境",
]
DEFAULT_COMMENT_EXCLUDES = [
    "我店", "我的店", "本土店", "跨境店", "新手村", "限单", "二审", "三审",
    "封店", "店铺", "出单", "上架", "履约", "货不对板", "服务商",
    "货代", "海外仓", "虚拟仓", "专线", "陪跑", "培训", "招商", "代运营",
]

COMMENT_API_BASE = os.environ.get('COMMENT_API_BASE', 'http://127.0.0.1:5555').rstrip('/')

def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument('--input', required=True)
    p.add_argument('--output', required=True)
    p.add_argument('--days', type=int, default=1)
    p.add_argument('--target', type=int, default=100)
    p.add_argument('--pages', type=int, default=2)
    p.add_argument('--count', type=int, default=50)
    p.add_argument('--cookie', default=os.environ.get('DOUYIN_COOKIE', ''))
    p.add_argument('--now', default='2026-04-15T00:00:00+00:00')
    p.add_argument('--extra-name-excludes', default='')
    p.add_argument('--extra-comment-excludes', default='')
    return p.parse_args()

def post_comment(cookie, detail_id, pages, count):
    payload = json.dumps({'cookie': cookie, 'detail_id': detail_id, 'pages': pages, 'count': count, 'reply': False}).encode()
    req = urllib.request.Request(f'{COMMENT_API_BASE}/douyin/comment', data=payload, headers={'Content-Type': 'application/json', 'token': ''}, method='POST')
    return json.loads(urllib.request.urlopen(req, timeout=180).read().decode())

def healthcheck_comment_api():
    req = urllib.request.Request(f'{COMMENT_API_BASE}/token', headers={'token': ''}, method='GET')
    try:
        raw = urllib.request.urlopen(req, timeout=30).read().decode()
        data = json.loads(raw)
        return data.get('message') == '验证成功！'
    except Exception:
        return False

def is_excluded(nickname, unique_id, text, name_excludes, comment_excludes):
    name = f'{nickname} {unique_id}'.lower()
    comment = (text or '').lower()
    return any(k.lower() in name for k in name_excludes) or any(k.lower() in comment for k in comment_excludes)

def save_rows(path, rows):
    fields = ['keyword','source_video_id','source_video_author','source_video_url','source_video_desc','source_video_create_time','comment_nickname','comment_unique_id','ip_location','comment_profile_url','comment_text']
    with open(path, 'w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)

def main():
    args = parse_args()
    if not args.cookie:
        raise SystemExit('Missing Douyin cookie. Pass --cookie or DOUYIN_COOKIE.')
    if not healthcheck_comment_api():
        raise SystemExit(f'Comment API unavailable at {COMMENT_API_BASE}. Start the comment service first.')

    name_excludes = DEFAULT_NAME_EXCLUDES + [x.strip() for x in args.extra_name_excludes.split(',') if x.strip()]
    comment_excludes = DEFAULT_COMMENT_EXCLUDES + [x.strip() for x in args.extra_comment_excludes.split(',') if x.strip()]

    with open(args.input, encoding='utf-8') as f:
        search = json.load(f)

    now_str = args.now.replace('Z', '+00:00')
    now = datetime.fromisoformat(now_str)
    cutoff = now - timedelta(days=args.days)
    recent = []
    seen_videos = set()
    for item in search['items']:
        aweme_id = item.get('aweme_id')
        if not aweme_id or aweme_id in seen_videos:
            continue
        seen_videos.add(aweme_id)
        dt = datetime.fromtimestamp(item.get('create_time') or 0, tz=timezone.utc)
        if dt >= cutoff:
            item['create_datetime'] = dt.isoformat()
            recent.append(item)
    recent.sort(key=lambda x: x.get('create_time') or 0, reverse=True)

    rows = []
    seen_users = set()
    stats = {'search_items': len(search['items']), 'recent_videos': len(recent), 'videos_attempted': 0, 'comments_seen': 0, 'duplicates': 0, 'excluded': 0, 'errors': 0}

    for video in recent:
        if len(rows) >= args.target:
            break
        stats['videos_attempted'] += 1
        try:
            data = post_comment(args.cookie, video['aweme_id'], args.pages, args.count)
        except Exception:
            stats['errors'] += 1
            continue
        comments = data.get('data') or []
        stats['comments_seen'] += len(comments)
        for c in comments:
            if len(rows) >= args.target:
                break
            sec_uid = c.get('sec_uid')
            if not sec_uid:
                stats['excluded'] += 1
                continue
            if sec_uid in seen_users:
                stats['duplicates'] += 1
                continue
            nickname = c.get('nickname', '')
            unique_id = c.get('unique_id', '')
            text = (c.get('text') or '').replace('\n', ' ')
            if is_excluded(nickname, unique_id, text, name_excludes, comment_excludes):
                stats['excluded'] += 1
                continue
            seen_users.add(sec_uid)
            rows.append({
                'keyword': video.get('keyword', ''),
                'source_video_id': video['aweme_id'],
                'source_video_author': video.get('author_nickname', ''),
                'source_video_url': video.get('url', ''),
                'source_video_desc': video.get('desc', '').replace('\n', ' '),
                'source_video_create_time': video.get('create_datetime', ''),
                'comment_nickname': nickname,
                'comment_unique_id': unique_id,
                'ip_location': c.get('ip_label', ''),
                'comment_profile_url': f'https://www.douyin.com/user/{sec_uid}',
                'comment_text': text,
            })
        save_rows(args.output, rows)
        time.sleep(0.2)

    save_rows(args.output, rows)
    print(json.dumps({'output': args.output, 'rows': len(rows), 'stats': stats}, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
