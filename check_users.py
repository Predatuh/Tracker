import sys
sys.path.insert(0, 'backend')
from app import create_app, db
from app.models.user import User

app = create_app()
with app.app_context():
    users = User.query.all()
    print(f'FOUND {len(users)} users')
    for u in users:
        print(f'  id={u.id} name={u.name!r} username={u.username!r} admin={u.is_admin} role={u.role}')
    if not users:
        print('  NO USERS - creating admin...')
