var _ = require('lodash');

var permissionPolicies = [
  'ModelPolicy',
  'AuditPolicy',
  'OwnerPolicy',
  'PermissionPolicy',
  'RolePolicy',
  'CriteriaPolicy'
];

module.exports = function sailsPermissions(sails) {
  return {
    identity: 'permissions',

    /**
     * Local cache of Model name -> id mappings to avoid excessive database lookups.
     */
    _modelCache: { },

    configure: function () {
      if (!_.isObject(sails.config.permissions)) sails.config.permissions = { };

      sails.config.blueprints.populate = false;
    },
    initialize: function (next) {
      sails.log.debug('permissions: initializing sails-permissions hook');

      if (!validateDependencies(sails)) {
        sails.log.error('Cannot find sails-auth hook. Did you "npm install @muhammadghazali/sails-auth --save"?');
        sails.log.error('Please see README for installation instructions: https://github.com/muhammadghazali/sails-auth/atg-custom');
        return sails.lower();
      }

      if (!validatePolicyConfig(sails)) {
        sails.log.error('One or more required policies are missing.');
        sails.log.error('Please see README for installation instructions: https://github.com/muhammadghazali/sails-permissions/atg-custom');
        return sails.lower();
      }

      sails.after(sails.config.permissions.afterEvent, function () {
          installModelOwnership(sails);
      });

      sails.after('hook:orm:loaded', function () {
        Model.count()
          .then(function (count) {
            if (count == sails.models.length) return next();

            return initializeFixtures(sails)
              .then(function () {
                sails.emit('hook:permissions:loaded');
                next();
              });
          })
          .catch(function (error) {
            sails.log.error(error);
            next(error);
          });
      });
    }
  };
};

/**
 * Install the application. Sets up default Roles, Users, Models, and
 * Permissions, and creates an admin user.
 */
function initializeFixtures (sails) {
  return require('../../config/fixtures/model').createModels()
    .bind({ })
    .then(function (models) {
      this.models = models;

      sails.hooks['sails-permissions']._modelCache = _.keyBy(models, 'identity');

      return require('../../config/fixtures/role').create();
    })
    .then(function (roles) {
      this.roles = roles;
      var userModel = _.find(this.models, { name: 'User' });
      return require('../../config/fixtures/user').create(this.roles, userModel);
    })
    .then(function () {
      return User.findOne({ email: sails.config.permissions.adminEmail });
    })
    .then(function (user) {
      sails.log.verbose('sails-permissions: created admin user:', user);
      user.createdBy = user.id;
      user.owner = user.id;
      return user.save();
    })
    .then(function (admin) {
      return require('../../config/fixtures/permission').create(this.roles, this.models, admin);
    })
    .catch(function (error) {
      sails.log.error(error);
    });
}

function installModelOwnership (sails) {
  var models = sails.models;
  if (sails.config.models.autoCreatedBy === false) return;

  _.each(models, function (model) {
    if (model.autoCreatedBy === false) return;

    _.defaults(model.attributes, {
      createdBy: {
        model: 'User',
        index: true
      },
      owner: {
        model: 'User',
        index: true
      }
    });
  });
}

function validatePolicyConfig (sails) {
  var policies = sails.config.policies;
  var validations = [];

  validations.push(_.isArray(policies['*']));
  validations.push(policies.hasOwnProperty('AuthController'));

  // TODO why do we need to allow public access the AuthController
  // _.contains(policies.AuthController['*']

  for (var i = 0; i < permissionPolicies.length; i++) {
    validations.push(_.includes(policies['*'], permissionPolicies[i]));
  }

  return _.every(validations);
}

function validateDependencies (sails) {
  return !!sails.hooks['sails-auth'];
}
