import gts from '@graphql-tools/schema';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

import User from '../models/User.js';
import Section from '../models/Section.js';

const APP_SECRET = 'sdlfkj08234lksdf'; // move to env

const { makeExecutableSchema } = gts;

const typeDefs = `
scalar Object
scalar Null

type User {
  id: String!
  firstName: String!
  lastName: String!
  middleInitial: String
  email: String!
  password: String!
  role: Object!
}
type Section {
  id: String!
  name: String!
  adviserId: User!
}
input UserInput {
  id: String
  firstName: String
  lastName: String
  middleInitial: String
  email: String
  password: String
  role: Object
}
type Query {
  me: User
  user(id: String!): User
  users(filter: UserInput): [User]
  sections: [Section]
}
type Mutation {
  addUser(id: String!, firstName: String!, lastName: String!, middleInitial: String, email: String!, password: String!, role: Object!): User
  addUsers(users: [UserInput!]!): [User]
  deleteUsers: Null
  addSection(id: String!, name: String, adviserId: String!, students: [UserInput!]!): Section
  login(email: String!, password: String!): User
  logout: Null
}
`;

const generateToken = (user) => {
  return jwt.sign({ data: user }, APP_SECRET);
};

const validateToken = (token) => {
  return jwt.verify(token, APP_SECRET);
};

const throwUnauthorizedError = () => {
  throw new Error('You are not authorized to perform this action!');
};

const protectEndpoint = async (context, role, callback) => {
  const cookies = context.req.cookies;
  if (cookies && cookies.token) {
    try {
      const decoded = validateToken(cookies.token);
      const userRole = decoded.data.role.type;
      if (role.includes(userRole)) {
        return await callback();
      } else {
        throwUnauthorizedError();
      }
    } catch (err) {
      throw new Error(err);
    }
  } else {
    throwUnauthorizedError();
  }
};

const getRequesterId = (context) => {
  const cookies = context.req.cookies;
  if (cookies && cookies.token) {
    const decoded = validateToken(cookies.token);
    return decoded.data._id;
  }
};

const createUser = async (context, id, firstName, lastName, middleInitial, email, password, role) => {
  try {
    const hash = await bcrypt.hash(password, 10);
    const requesterId = getRequesterId(context);
    const user = await new User({ id, firstName, lastName, middleInitial, email, password: hash, role, createdAt: Date.now().toString(), createdBy: requesterId }).save();
    if (user) {
      return user;
    }
  } catch (err) {
    throw new Error(err);
  }
};

const resolvers = {
  Query: {
    me: async (root, args, context) => {
      const requesterId = getRequesterId(context);
      if (!requesterId) {
        return null;
      } else {
        return await User.findById(requesterId);
      }
    },
    users: async (root, args, context) => {
      const callback = async () => {
        let filter = {};
        if (args.filter) {
          filter = args.filter;
        }

        try {
          const users = await User.find(filter).exec();
          if (users) {
            return users;
          }
        } catch (err) {
          throw new Error(err);
        }
      };
      return await protectEndpoint(context, ['admin', 'schoolAdmin'], callback);
    },
    sections: async (root, args, context) => {
      const callback = async () => {
        try {
          const sections = await Section.find({}).exec();
          if (sections) {
            for (const section of sections) {
              const adviser = await User.findById(section.adviserId).exec();
              if (adviser) {
                section.adviserId = adviser;
              }
            }
            return sections;
          }
        } catch (err) {
          throw new Error(err);
        }
      };
      return await protectEndpoint(context, ['admin', 'schoolAdmin', 'teacher'], callback);
    }
  },
  Mutation: {
    addUser: async (root, { id, firstName, lastName, middleInitial, email, password, role }, context) => {
      const callback = async () => {
        return await createUser(context, id, firstName, lastName, middleInitial, email, password, role);
      };

      return await protectEndpoint(context, ['admin', 'schoolAdmin'], callback);
    },

    addUsers: async (root, { users }, context) => {
      const callback = async () => {
        const newUsers = [];
        for (const user of users) {
          const { id, firstName, lastName, middleInitial, email, password, role } = user;
          const newUser = await createUser(context, id, firstName, lastName, middleInitial, email, password, role);
          newUsers.push(newUser);
        }
        return newUsers;
      };

      return await protectEndpoint(context, ['admin', 'schoolAdmin'], callback);
    },

    deleteUsers: async (root, args, context) => {
      const callback = async () => {
        const users = await User.find().exec();
        const nonAdmin = users.filter(user => {
          return user.role.type != 'admin';
        });
        for (const user of nonAdmin) {
          await User.deleteOne({ id: user.id }).exec();
        }
      };

      return await protectEndpoint(context, ['admin'], callback);
    },

    addSection: async (root, { id, name, adviserId, students }, context) => {
      const callback = async () => {
        try {
          const requesterId = getRequesterId(context);
          const adviser = await User.findOne({ id: adviserId }).exec();
          if (adviser) {
            const section = await new Section({ id, name, adviserId: adviser._id, createdAt: Date.now().toString(), createdBy: requesterId }).save();
            if (section) {
              const newStudents = [];
              for (const student of students) {
                const { id, firstName, lastName, middleInitial, email, password, role } = student;
                role.sectionId = section._id;
                const newUser = await createUser(context, id, firstName, lastName, middleInitial, email, password, role);
                newStudents.push(newUser);
              }
              return section;
            }
          } else {
            throw new Error('Adviser not found');
          }
        } catch (err) {
          throw new Error(err);
        }
      };
      return await protectEndpoint(context, ['admin', 'schoolAdmin'], callback);
    },

    login: async (root, { email, password }, context) => {
      try {
        const user = await User.findOne({ email });
        if (!user) {
          throw new Error('Invalid email or password');
        }

        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) {
          throw new Error('Invalid email or password');
        }

        const token = generateToken(user);
        context.res.cookie('token', token, {
          httpOnly: true,
          maxAge: 1000 * 60 * 60 * 24 * 365, // 1 year cookie
        });

        return user;
      } catch (err) {
        throw new Error(err);
      }
    },
    logout: async (root, args, context) => {
      try {
        context.res.clearCookie('token');
      } catch (err) {
        throw new Error(err);
      }
    }
  }
};

const schema = makeExecutableSchema({
  typeDefs,
  resolvers
});

export default schema;