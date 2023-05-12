import React, {useState, useEffect} from 'react';
import {useDispatch, useSelector} from 'react-redux';
import AsyncStorage from '@react-native-async-storage/async-storage';

import Avatar from './components/avatar';
import {
  reset,
  setIsLoggedIn,
  setUserEmail,
  setCurrentUsername,
  setFollowers,
  setFollowing,
  setFitcheckArray,
  setListingArray,
  setPageRefresher,
} from '../reducers/user';

import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  FlatList,
  SafeAreaView,
  ScrollView,
} from 'react-native';

import styles from './settings.style';

export default function Settings({navigation}) {
  const dispatch = useDispatch();
  const {
    isLoggedIn,
    email,
    currentusername,
    fullname,
    followers,
    following,
    fitcheckArray,
    listingArray,
    pageRefresher,
  } = useSelector(state => state.user);
  dispatch(setPageRefresher(!pageRefresher));

  const [changeAvatar, setChangeAvatar] = useState(false);

  const handleLogout = () => {
    dispatch(reset());
    AsyncStorage.clear();
    navigation.navigate('Landing');
  };

  const handleBuyButtonPress = async () => {
    const formData = {
      username: currentusername,
      image: base64Image,
    };

    fetch(
      'http://192.168.1.30:3000/setAvatar' ||
        'http://192.168.1.30:3000/setAvatar',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      },
    )
      .then(response => {
        return response.json();
      })
      .then(result => {
        setChangeAvatar(false);
      })
      .catch(error => {
        console.error(error);
      });
  };

  return (
    <SafeAreaView
      style={{
        ...styles.fitcheckContainer,
        marginTop: 25,
        marginHorizontal: 10,
      }}>
      {changeAvatar ? (
        <>
          <View>
            <Image source={{uri: selectedImage}} style={styles.selectedImage} />
          </View>
          <TouchableOpacity style={styles.button} onPress={pickImage}>
            <Text style={styles.buttonText}>Pick a image from camera roll</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.button} onPress={uploadImage}>
            <Text style={styles.buttonText}>Save Profile Image</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={{...styles.button, width: '60%', alignSelf: 'center'}}
            onPress={() => setChangeAvatar(false)}>
            <Text style={styles.buttonText}>Cancel</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Avatar
            incomingStyle={{width: 100, height: 100, alignSelf: 'center'}}
            incomingUsername={currentusername}
          />
          <TouchableOpacity
            style={styles.button}
            onPress={() => setChangeAvatar(true)}>
            <Text style={styles.buttonText}>Change Avatar</Text>
          </TouchableOpacity>
        </>
      )}
      <View
        style={{
          marginBottom: 0,
          position: 'absolute',
          bottom: 0,
          width: '100%',
        }}>
        <TouchableOpacity onPress={handleLogout} style={styles.button}>
          <Text style={styles.buttonText}>Logout</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
