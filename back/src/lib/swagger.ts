/**
 * Especificación OpenAPI 3.0 para agents-agency back.
 * Montada en /api/docs solo fuera de producción.
 */
export const swaggerSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Agents Agency API',
    version: '1.0.0',
    description: 'API del backend de 3A Estudio (agents-agency). Gestión de agentes IA, clientes, contactos, presupuestos, estudios de mercado y más.',
  },
  servers: [
    { url: 'http://localhost:4000', description: 'Desarrollo local' },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Token Supabase (Authorization: Bearer <token>)',
      },
    },
    schemas: {
      ErrorResponse: {
        type: 'object',
        properties: {
          error: { type: 'string', example: 'No autenticado' },
        },
      },
      Agent: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string', nullable: true },
          sectorId: { type: 'string', nullable: true },
          systemPrompt: { type: 'string', nullable: true },
          active: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Client: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          nombre: { type: 'string' },
          email: { type: 'string', nullable: true },
          telefono: { type: 'string', nullable: true },
          direccion: { type: 'string', nullable: true },
          codigo: { type: 'string', nullable: true, description: 'Código corto tipo cli-01' },
          activo: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Contact: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          email: { type: 'string', nullable: true },
          phone: { type: 'string', nullable: true },
          status: { type: 'string', enum: ['new', 'contacted', 'qualified', 'lost'] },
          agentId: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Budget: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          clientId: { type: 'string', nullable: true },
          status: { type: 'string' },
          total: { type: 'number' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      MarketStudy: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          status: { type: 'string' },
          result: { type: 'object', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Sector: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string', nullable: true },
        },
      },
      Skill: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          type: { type: 'string' },
          description: { type: 'string', nullable: true },
        },
      },
      ChatMessage: {
        type: 'object',
        properties: {
          role: { type: 'string', enum: ['user', 'assistant'] },
          content: { type: 'string' },
        },
      },
      PaginatedResponse: {
        type: 'object',
        properties: {
          items: { type: 'array', items: {} },
          total: { type: 'integer' },
          page: { type: 'integer' },
          limit: { type: 'integer' },
        },
      },
    },
  },
  security: [{ BearerAuth: [] }],
  paths: {
    // ─── Auth ────────────────────────────────────────────────────────────────
    '/api/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Login de usuario',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Login correcto — devuelve token Supabase' },
          401: { description: 'Credenciales incorrectas', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        },
      },
    },
    '/api/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Perfil del usuario autenticado',
        responses: {
          200: { description: 'Usuario actual con rol' },
          401: { description: 'No autenticado' },
        },
      },
    },

    // ─── Agentes ─────────────────────────────────────────────────────────────
    '/api/agents': {
      get: {
        tags: ['Agentes'],
        summary: 'Listar agentes IA',
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          200: { description: 'Lista de agentes', content: { 'application/json': { schema: { $ref: '#/components/schemas/PaginatedResponse' } } } },
        },
      },
      post: {
        tags: ['Agentes'],
        summary: 'Crear agente',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Agent' } } },
        },
        responses: {
          201: { description: 'Agente creado' },
          422: { description: 'Datos inválidos' },
        },
      },
    },
    '/api/agents/{id}': {
      get: {
        tags: ['Agentes'],
        summary: 'Obtener agente por ID',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Agente', content: { 'application/json': { schema: { $ref: '#/components/schemas/Agent' } } } },
          404: { description: 'No encontrado' },
        },
      },
      patch: {
        tags: ['Agentes'],
        summary: 'Actualizar agente',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Agent' } } } },
        responses: { 200: { description: 'Agente actualizado' }, 404: { description: 'No encontrado' } },
      },
      delete: {
        tags: ['Agentes'],
        summary: 'Eliminar agente',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 204: { description: 'Eliminado' }, 404: { description: 'No encontrado' } },
      },
    },

    // ─── Chat ─────────────────────────────────────────────────────────────────
    '/api/chat/{agentId}': {
      post: {
        tags: ['Chat IA'],
        summary: 'Chatear con un agente',
        parameters: [{ name: 'agentId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['messages'],
                properties: {
                  messages: { type: 'array', items: { $ref: '#/components/schemas/ChatMessage' } },
                  contactId: { type: 'string', nullable: true },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Respuesta del agente', content: { 'application/json': { schema: { $ref: '#/components/schemas/ChatMessage' } } } },
          404: { description: 'Agente no encontrado' },
        },
      },
    },

    // ─── Clientes ─────────────────────────────────────────────────────────────
    '/api/clients': {
      get: {
        tags: ['Clientes'],
        summary: 'Listar clientes (tenants)',
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Lista de clientes' } },
      },
      post: {
        tags: ['Clientes'],
        summary: 'Crear cliente',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Client' } } } },
        responses: { 201: { description: 'Cliente creado' } },
      },
    },
    '/api/clients/{id}': {
      get: {
        tags: ['Clientes'],
        summary: 'Obtener cliente',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Cliente' }, 404: { description: 'No encontrado' } },
      },
      patch: {
        tags: ['Clientes'],
        summary: 'Actualizar cliente',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Client' } } } },
        responses: { 200: { description: 'Cliente actualizado' } },
      },
      delete: {
        tags: ['Clientes'],
        summary: 'Eliminar cliente',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 204: { description: 'Eliminado' } },
      },
    },

    // ─── Contactos ────────────────────────────────────────────────────────────
    '/api/contacts': {
      get: {
        tags: ['Contactos'],
        summary: 'Listar contactos / leads',
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Lista de contactos' } },
      },
      post: {
        tags: ['Contactos'],
        summary: 'Crear contacto',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Contact' } } } },
        responses: { 201: { description: 'Contacto creado' } },
      },
    },
    '/api/contacts/{id}': {
      get: {
        tags: ['Contactos'],
        summary: 'Obtener contacto',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Contacto' }, 404: { description: 'No encontrado' } },
      },
      patch: {
        tags: ['Contactos'],
        summary: 'Actualizar contacto',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Contact' } } } },
        responses: { 200: { description: 'Contacto actualizado' } },
      },
      delete: {
        tags: ['Contactos'],
        summary: 'Eliminar contacto',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 204: { description: 'Eliminado' } },
      },
    },

    // ─── Presupuestos ─────────────────────────────────────────────────────────
    '/api/budgets': {
      get: {
        tags: ['Presupuestos'],
        summary: 'Listar presupuestos',
        responses: { 200: { description: 'Lista de presupuestos' } },
      },
      post: {
        tags: ['Presupuestos'],
        summary: 'Crear presupuesto',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Budget' } } } },
        responses: { 201: { description: 'Presupuesto creado' } },
      },
    },
    '/api/budgets/{id}': {
      get: {
        tags: ['Presupuestos'],
        summary: 'Obtener presupuesto',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Presupuesto' }, 404: { description: 'No encontrado' } },
      },
      patch: {
        tags: ['Presupuestos'],
        summary: 'Actualizar presupuesto',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Budget' } } } },
        responses: { 200: { description: 'Presupuesto actualizado' } },
      },
      delete: {
        tags: ['Presupuestos'],
        summary: 'Eliminar presupuesto',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 204: { description: 'Eliminado' } },
      },
    },

    // ─── Estudios de mercado ──────────────────────────────────────────────────
    '/api/market-studies': {
      get: {
        tags: ['Estudios de mercado'],
        summary: 'Listar estudios de mercado',
        responses: { 200: { description: 'Lista de estudios' } },
      },
      post: {
        tags: ['Estudios de mercado'],
        summary: 'Crear / iniciar estudio de mercado',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['title'],
                properties: {
                  title: { type: 'string' },
                  sector: { type: 'string', nullable: true },
                  clientId: { type: 'string', nullable: true },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Estudio creado' } },
      },
    },
    '/api/market-studies/{id}': {
      get: {
        tags: ['Estudios de mercado'],
        summary: 'Obtener estudio',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Estudio' }, 404: { description: 'No encontrado' } },
      },
      delete: {
        tags: ['Estudios de mercado'],
        summary: 'Eliminar estudio',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 204: { description: 'Eliminado' } },
      },
    },

    // ─── Sectores ─────────────────────────────────────────────────────────────
    '/api/sectors': {
      get: {
        tags: ['Sectores'],
        summary: 'Listar sectores',
        responses: { 200: { description: 'Lista de sectores' } },
      },
    },
    '/api/sectors/{id}': {
      get: {
        tags: ['Sectores'],
        summary: 'Obtener sector',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Sector' }, 404: { description: 'No encontrado' } },
      },
    },

    // ─── Skills ───────────────────────────────────────────────────────────────
    '/api/skills': {
      get: {
        tags: ['Skills'],
        summary: 'Listar skills de agentes',
        responses: { 200: { description: 'Lista de skills' } },
      },
    },

    // ─── Stats ────────────────────────────────────────────────────────────────
    '/api/stats': {
      get: {
        tags: ['Estadísticas'],
        summary: 'Resumen estadístico global',
        responses: { 200: { description: 'KPIs globales: agentes, contactos, mensajes, presupuestos' } },
      },
    },

    // ─── Booking ──────────────────────────────────────────────────────────────
    '/api/booking/slots': {
      get: {
        tags: ['Booking'],
        summary: 'Obtener slots disponibles',
        parameters: [
          { name: 'agentId', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'date', in: 'query', required: true, schema: { type: 'string', format: 'date' } },
        ],
        responses: { 200: { description: 'Slots libres' } },
      },
    },
    '/api/booking': {
      post: {
        tags: ['Booking'],
        summary: 'Crear reserva',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['agentId', 'start', 'end'],
                properties: {
                  agentId: { type: 'string' },
                  contactId: { type: 'string', nullable: true },
                  start: { type: 'string', format: 'date-time' },
                  end: { type: 'string', format: 'date-time' },
                  notes: { type: 'string', nullable: true },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Reserva creada' }, 409: { description: 'Slot no disponible' } },
      },
    },
  },
};
