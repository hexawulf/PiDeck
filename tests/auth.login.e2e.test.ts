import request from 'supertest';
import { createServer } from 'http';
import express from 'express';
import { registerRoutes } from '../server/routes';

describe('Auth + protected endpoints', () => {
  let app: express.Application;
  let server: any;

  beforeAll(async () => {
    app = express();
    app.use(express.json());
    server = await registerRoutes(app);
  });

  afterAll((done) => {
    server.close(done);
  });

  it('login sets cookie; protected routes OK', async () => {
    const agent = request.agent(app);
    const password = process.env.APP_PASSWORD || 'UyGMtfwOhmPKGGJtx0KObXI3';

    const login = await agent
      .post('/api/auth/login')
      .set('Origin', 'https://pideck.piapps.dev')
      .send({ password });

    expect(login.status).toBe(200);
    expect(login.headers['set-cookie']).toBeDefined();

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.authenticated).toBe(true);

    const logs = await agent.get('/api/rasplogs');
    expect(logs.status).toBe(200);
    expect(Array.isArray(logs.body)).toBe(true);
  });

  it('rate limiting works on login', async () => {
    const password = 'wrong-password';
    
    // Make multiple failed login attempts
    for (let i = 0; i < 12; i++) {
      const response = await request(app)
        .post('/api/auth/login')
        .set('Origin', 'https://pideck.piapps.dev')
        .send({ password });
      
      if (i >= 10) {
        // After 10 attempts, should get rate limited
        expect(response.status).toBe(429);
        expect(response.body.message).toContain('Too many login attempts');
      }
    }
  });
});