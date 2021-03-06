#!/usr/bin/env python
from quart import Quart, render_template, websocket, request
from functools import wraps
from ws import sending, receiving, User, authorized_users
import uuid
import asyncio
from quart_auth import AuthUser, AuthManager, login_user, login_required, current_user, Unauthorized

app = Quart(__name__)
app.config.from_object('config.Config')
app.static_folder = app.config['STATIC_PATH']
app.template_folder = app.config['STATIC_PATH']

auth_manager = AuthManager()
auth_manager.user_class = User

app.secret_key = app.config['SECRET_KEY']

@app.route('/')
async def index():
    return await render_template("index.html")

@app.route('/api/v1/auth', methods=['POST'])
async def auth():
    data = await request.json
    user_id = str(uuid.uuid4())[:8]
    u = User(user_id)
    u.name = data['login'] or 'Anonymous'+user_id
    login_user(u)
    authorized_users.add(u)
    return {}

@app.route('/api/v1/world/<name>', methods=['GET'])
@login_required
async def world(name):
    if name != 'lemuria':
        return {}
    w = {
        'name': 'lemuria',
        'avatars': ['michel', 'jeanne', 'robin'],
        'objects':  [
            ['tracteur1', 0, 0, 0],
            ['poule1', 1, 0, 0],
            ['arbre1', 1, 0, 1],
            ['arbre10', 2, 0, 0],
            ['arbre17', -1, 0, 1],
            ['arbre20', 2, 0.5, 3],
        ]
    }
    return w

@app.websocket('/ws')
async def wsocket():
    producer = asyncio.create_task(sending())
    consumer = asyncio.create_task(receiving())
    await asyncio.gather(producer, consumer)

@app.errorhandler(404)
async def redirect(e):
    return await render_template("index.html")

auth_manager.init_app(app)

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=5169)