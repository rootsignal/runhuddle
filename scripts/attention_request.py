"""Bounded display-only excerpts from explicit input requests; never decisions."""
def request(event, payload, stamp):
    tool = payload.get('tool_name') or payload.get('toolName') or ''
    data = payload.get('tool_input') or payload.get('toolInput') or {}
    if not isinstance(data, dict):
        data = {}
    kind = 'permission' if event == 'PermissionRequest' or payload.get('notification_type') == 'permission_prompt' else 'input'
    if tool == 'AskUserQuestion' or event == 'Elicitation' or payload.get('notification_type') == 'elicitation_dialog':
        kind = 'question'
    if tool == 'ExitPlanMode':
        kind = 'plan'
    if event == 'StopFailure':
        kind = 'error'
    parts = []
    questions = data.get('questions', [])
    if isinstance(questions, list):
        for question in questions[:6]:
            if isinstance(question, dict) and isinstance(question.get('question'), str):
                parts.append(question['question'][:1000])
                options = question.get('options', [])
                if isinstance(options, list):
                    parts.extend('• ' + opt['label'][:200] for opt in options[:10] if isinstance(opt, dict) and isinstance(opt.get('label'), str))
    if not parts:
        for value in [data.get('command'), data.get('file_path'), payload.get('message')]:
            if isinstance(value, str) and value.strip():
                parts.append(value[:3000])
                break
    if kind == 'permission' and tool and isinstance(tool, str):
        parts.insert(0, tool[:100])
    return {'kind': kind, 'detail': '\n'.join(parts)[:4000] or None, 'since': stamp}
