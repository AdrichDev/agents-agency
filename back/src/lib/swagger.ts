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
      OperatorServiceToken: {
        type: 'apiKey',
        in: 'header',
        name: 'x-service-token',
        description: 'Token estático de servicio del Operator Agent (server-to-server). Se compara contra OPERATOR_SERVICE_TOKEN en tiempo constante. Las rutas /service/operator/* van FUERA de /api y NO usan el Bearer JWT de usuario.',
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
      Invoice: {
        type: 'object',
        description: 'Nace automáticamente al aceptar un Budget (ensureInvoiceForBudget). No existe alta manual.',
        properties: {
          id: { type: 'string' },
          budgetId: { type: 'string' },
          status: { type: 'string', enum: ['pendiente', 'cobrada'] },
          paidAt: { type: 'string', format: 'date-time', nullable: true, description: 'Se fija al pasar a cobrada; se limpia al salir de cobrada' },
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

    // ─── Facturas ─────────────────────────────────────────────────────────────
    // Router montado en /api/invoices (routes/invoices.ts) — reconciliación: existía en
    // código sin reflejo alguno en esta spec. Solo lectura + transición de cobro; el alta
    // es automática al aceptar un Budget (ver routes/budgets.ts, ensureInvoiceForBudget).
    '/api/invoices': {
      get: {
        tags: ['Facturas'],
        summary: 'Listar facturas (con budget/tenant/líneas embebidos)',
        description: 'Devuelve { invoices, metrics } — metrics agrega sobre TODAS las facturas (computeInvoiceMetrics).',
        responses: {
          200: { description: 'Lista de facturas + métricas' },
        },
      },
    },
    '/api/invoices/{id}': {
      get: {
        tags: ['Facturas'],
        summary: 'Obtener factura por id',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Factura', content: { 'application/json': { schema: { $ref: '#/components/schemas/Invoice' } } } },
          404: { description: 'No encontrada' },
        },
      },
    },
    '/api/invoices/{id}/status': {
      put: {
        tags: ['Facturas'],
        summary: 'Marcar cobro / revertir estado',
        description: 'Set cerrado pendiente|cobrada. Al pasar a cobrada fija paidAt = now(); cualquier otro valor lo limpia (null).',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['status'],
                properties: { status: { type: 'string', enum: ['pendiente', 'cobrada'] } },
              },
            },
          },
        },
        responses: {
          200: { description: 'Factura actualizada', content: { 'application/json': { schema: { $ref: '#/components/schemas/Invoice' } } } },
          404: { description: 'No encontrada' },
          422: { description: 'status inválido' },
        },
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

    // ─── Operator Agent — Agenda ──────────────────────────────────────────────
    // Router serviceOperatorRouter (routes/service-operator.ts) montado en
    // /service/operator, FUERA de /api → no pasa por el gate JWT de usuario.
    // Se autentica SOLO con el header x-service-token (OperatorServiceToken).
    // Agenda del owner = PlatformAppointment (espejo de Google Calendar); la
    // escritura sincroniza con Google best-effort si la integración está conectada.
    // Nota: las escrituras de /agenda NO exigen `confirmado` (a diferencia de
    // /clientes y /agentes); solo el DELETE exige `confirmar=true`.
    '/service/operator/agenda': {
      get: {
        tags: ['Operator'],
        summary: 'Listar citas de la agenda del owner en un rango',
        security: [{ OperatorServiceToken: [] }],
        parameters: [
          { name: 'desde', in: 'query', schema: { type: 'string', format: 'date' }, description: 'YYYY-MM-DD; por defecto hoy' },
          { name: 'hasta', in: 'query', schema: { type: 'string', format: 'date' }, description: 'YYYY-MM-DD; por defecto = desde' },
        ],
        responses: {
          200: { description: '{ desde, hasta, total, citas[] } — citas no canceladas del rango' },
          400: { description: 'desde/hasta deben ser fechas YYYY-MM-DD válidas (hasta >= desde)' },
          401: { description: 'x-service-token ausente o inválido' },
        },
      },
      post: {
        tags: ['Operator'],
        summary: 'Crear una cita en la agenda del owner',
        description: 'Persiste SIEMPRE en BD; si el Calendar de plataforma está conectado, replica el evento en Google (best-effort, no bloquea la respuesta). No requiere `confirmado`.',
        security: [{ OperatorServiceToken: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['fecha', 'hora', 'cliente'],
                properties: {
                  fecha: { type: 'string', format: 'date', description: 'YYYY-MM-DD (hora de pared)' },
                  hora: { type: 'string', description: 'HH:MM (hora de pared)' },
                  cliente: { type: 'string' },
                  servicio: { type: 'string', nullable: true },
                  notas: { type: 'string', nullable: true },
                  duracion: { type: 'integer', nullable: true, description: 'Minutos; por defecto 30' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: '{ ok: true, cita } — cita creada' },
          400: { description: 'fecha/hora/cliente obligatorios o fecha/hora inválidas' },
          401: { description: 'x-service-token ausente o inválido' },
          500: { description: 'No se pudo crear la cita' },
        },
      },
    },
    '/service/operator/agenda/huecos': {
      get: {
        tags: ['Operator'],
        summary: 'Huecos libres de 30 min por día (09:00–19:00) en un rango',
        security: [{ OperatorServiceToken: [] }],
        parameters: [
          { name: 'desde', in: 'query', schema: { type: 'string', format: 'date' }, description: 'YYYY-MM-DD; por defecto hoy' },
          { name: 'hasta', in: 'query', schema: { type: 'string', format: 'date' }, description: 'YYYY-MM-DD; por defecto = desde' },
        ],
        responses: {
          200: { description: '{ desde, hasta, dias: [{ dia, huecos_libres }] } (huecos_libres=0 → día completo)' },
          400: { description: 'desde/hasta deben ser fechas YYYY-MM-DD válidas (hasta >= desde)' },
          401: { description: 'x-service-token ausente o inválido' },
        },
      },
    },
    '/service/operator/agenda/{id}': {
      patch: {
        tags: ['Operator'],
        summary: 'Editar una cita de la agenda',
        description: 'Actualiza fecha/hora/cliente/servicio/notas/estado. Sincroniza el cambio en Google best-effort si la cita ya está vinculada (gcalEventId). No requiere `confirmado`.',
        security: [{ OperatorServiceToken: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  fecha: { type: 'string', format: 'date', description: 'YYYY-MM-DD' },
                  hora: { type: 'string', description: 'HH:MM' },
                  cliente: { type: 'string' },
                  servicio: { type: 'string' },
                  notas: { type: 'string' },
                  estado: { type: 'string', enum: ['Confirmada', 'Pendiente', 'Completada', 'Cancelada'] },
                },
              },
            },
          },
        },
        responses: {
          200: { description: '{ ok: true, cita } — cita actualizada' },
          400: { description: 'estado inválido o fecha/hora inválidas' },
          401: { description: 'x-service-token ausente o inválido' },
          404: { description: 'Cita no encontrada' },
          500: { description: 'No se pudo editar la cita' },
        },
      },
      delete: {
        tags: ['Operator'],
        summary: 'Borrar una cita (irreversible)',
        description: 'Operación DESTRUCTIVA: elimina también el evento real en Google Calendar (best-effort). Exige `confirmar` truthy en query o body; sin ello → 400 confirmation_required.',
        security: [{ OperatorServiceToken: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'confirmar', in: 'query', schema: { type: 'boolean' }, description: 'Debe ser true (o "true"); también admisible en el body' },
        ],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { confirmar: { type: 'boolean', description: 'Alternativa a la query; true para confirmar' } },
              },
            },
          },
        },
        responses: {
          200: { description: '{ ok: true, borrada: id } — cita borrada' },
          400: { description: 'confirmar_requerido — reenviar con confirmar=true' },
          401: { description: 'x-service-token ausente o inválido' },
          404: { description: 'Cita no encontrada' },
          500: { description: 'No se pudo borrar la cita' },
        },
      },
    },
  },
};
