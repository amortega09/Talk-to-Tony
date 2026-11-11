"""Adapt optional draft fields to OpenAI's required, nullable wire format."""
import copy
import re


def reasoning_effort(text, previous=None):
    complex_request = r'\?|\b(?:edit|change|move|correct|update|replace|delete|remove|actually|instead|extend|shorten|rename|copy|repeat|same|what|which|how|read|query|show)\b|\badd\s+(?:a\s+)?(?:company|project|task)\b'
    return 'low' if previous is None and re.search(r'\bfrom\b.+\b(?:to|until)\b', text, re.I) and not re.search(complex_request, text, re.I) else 'medium'


def explicit_work_details(draft, text, catalog, previous=None):
    items = [i for i in draft.get('items', []) if i.get('category') == 'work']
    if len(items) != 1:
        return draft
    def has(name):
        return bool(re.search(r'(?<!\w)' + re.escape(name) + r'(?!\w)', text, re.I))
    def named(name, prefix):
        return bool(re.search(r'\b' + prefix + r'\s+(?:company\s+|project\s+|task\s+)?' + re.escape(name) + r'(?!\w)', text, re.I))
    companies = copy.deepcopy(catalog or [])
    for action in draft.get('actions') or []:
        if action['type'] == 'work_company_add' and has(action['company']) and re.search(r'\b(?:add|create|register)\s+(?:a\s+)?company\b', text, re.I) and not any(c['name'] == action['company'] for c in companies):
            companies.append({'name': action['company'], 'projects': []})
        if action['type'] == 'work_project_add' and has(action['project']):
            for company in companies:
                if company['name'] == action['company'] and action['project'] not in company['projects']:
                    company['projects'].append(action['project'])
    all_projects = list(dict.fromkeys(p for c in companies for p in c['projects']))
    slash = [(c['name'], p) for c in companies for p in all_projects if re.search(re.escape(c['name']) + r'\s*[/|]\s*' + re.escape(p) + r'(?!\w)', text, re.I)]
    old_items = [i for i in (previous or {}).get('items', []) if i.get('category') == 'work']
    old = old_items[0].get('details', {}) if len(old_items) == 1 else {}
    selected = [c for c in companies if named(c['name'], r'(?:for|at|company|employer)')]
    if not selected:
        selected = [c for c in companies if text.strip().lower() == c['name'].lower()]
    projects = [p for p in all_projects if named(p, r'(?:on|project|task)')]
    if not projects:
        projects = [p for p in all_projects if text.strip().lower() == p.lower()]
    negative = re.search(r"\b(?:not|never|except|without|don't|do not)\s+(?:for|at|company|employer|on|project|task)\b", text, re.I)
    company = '' if negative else slash[0][0] if len(slash) == 1 else selected[0]['name'] if len(selected) == 1 else '' if selected else old.get('company', '')
    project = '' if negative else slash[0][1] if len(slash) == 1 else projects[0] if len(projects) == 1 else '' if projects else old.get('project', '')
    items[0]['details'] = {**items[0].get('details', {}), 'company': company, 'project': project}
    return draft


def allows_null(schema):
    kind = schema.get('type', [])
    return kind == 'null' or (isinstance(kind, list) and 'null' in kind) or None in schema.get('enum', []) or any(allows_null(s) for s in schema.get('anyOf', []))


def strict_schema(schema):
    result = copy.deepcopy(schema)
    for key in ['uniqueItems', 'minLength', 'maxLength']:
        result.pop(key, None)
    if 'const' in result:
        result['enum'] = [result.pop('const')]
    if 'enum' in result and 'type' not in result:
        result['type'] = list(dict.fromkeys('null' if v is None else 'boolean' if isinstance(v, bool) else 'number' if isinstance(v, (int, float)) else 'string' for v in result['enum']))
    if 'oneOf' in result:
        result['anyOf'] = result.pop('oneOf')
    if 'anyOf' in result:
        result['anyOf'] = [strict_schema(s) for s in result['anyOf']]
    if 'items' in result:
        result['items'] = strict_schema(result['items'])
    if 'properties' in result:
        for key, value in result['properties'].items():
            if key in ['date', 'end_date']:
                value['pattern'] = r'^\d{4}-\d{2}-\d{2}$'
            if key in ['start', 'end']:
                value['pattern'] = r'^(?:(?:[01]\d|2[0-3]):(?:00|30)|24:00)$' if key == 'end' else r'^(?:[01]\d|2[0-3]):(?:00|30)$'
        result['properties'] = {k: strict_schema(v) if k in schema.get('required', []) or allows_null(v) else {'anyOf': [strict_schema(v), {'type': 'null'}]} for k, v in result['properties'].items()}
        result['required'] = list(result['properties'])
        result['additionalProperties'] = False
    return result


def from_wire(value, schema):
    if isinstance(value, list):
        return [from_wire(v, schema.get('items', {})) for v in value]
    if isinstance(value, dict):
        branches = schema.get('oneOf', schema.get('anyOf', []))
        if branches:
            selected = next((s for s in branches if s.get('properties', {}).get('type', {}).get('const') == value.get('type') or value.get('type') in s.get('properties', {}).get('type', {}).get('enum', [])), None)
            if selected:
                return from_wire(value, selected)
        properties = schema.get('properties', {})
        return {k: from_wire(v, properties.get(k, {})) for k, v in value.items() if not (v is None and k in properties and k not in schema.get('required', []) and not allows_null(properties[k]))}
    return value
