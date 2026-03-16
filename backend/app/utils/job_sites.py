JOB_SITE_REGISTRY = {
    '1093': {
        'name': 'Pierce County Solar',
        'slug': 'pierce-county-solar',
    },
}

DEFAULT_JOB_SITE_TOKEN = '1093'
DEFAULT_JOB_SITE = JOB_SITE_REGISTRY[DEFAULT_JOB_SITE_TOKEN]


def normalize_job_token(value):
    return ''.join(ch for ch in str(value or '') if ch.isdigit())


def resolve_job_site(value):
    token = normalize_job_token(value)
    site = JOB_SITE_REGISTRY.get(token)
    if not site:
        return None
    return {
        'token': token,
        'name': site['name'],
        'slug': site['slug'],
    }


def default_job_site():
    return {
        'token': DEFAULT_JOB_SITE_TOKEN,
        'name': DEFAULT_JOB_SITE['name'],
        'slug': DEFAULT_JOB_SITE['slug'],
    }